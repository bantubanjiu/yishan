import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatCaptureGroupEntry, formatCaptureSourceHeading, formatCaptureSourceHeadingFromTitle } from "./markdown.ts";
import type { AppConfig, CaptureMessage } from "./types.ts";

export type FetchBinaryResult = {
  bytes: Uint8Array;
  contentType?: string;
};

export type VaultWriterDeps = {
  fetchBinary?: (url: string) => Promise<FetchBinaryResult>;
};

export type VaultWriteResult = {
  notePath: string;
  attachmentName?: string;
};

export async function writeCaptureToVault(
  message: CaptureMessage,
  config: AppConfig,
  deps: VaultWriterDeps = {}
): Promise<VaultWriteResult> {
  validateCapture(message);

  const vaultPath = path.resolve(config.vaultPath);
  const inboxPath = resolveInsideVault(vaultPath, config.inboxDir, "Inbox directory");
  const attachmentsPath = resolveInsideVault(vaultPath, config.attachmentsDir, "Attachments directory");

  await mkdir(inboxPath, { recursive: true });

  const notePath = path.join(inboxPath, `${formatDate(message.capturedAt)}.md`);
  let attachmentName: string | undefined;
  let imageError: string | undefined;

  if (message.type === "image") {
    try {
      await mkdir(attachmentsPath, { recursive: true });
      const fetchBinary = deps.fetchBinary ?? defaultFetchBinary;
      const downloaded = await fetchBinary(message.imageUrl);
      attachmentName = buildAttachmentName(message, downloaded.contentType);
      await writeFile(path.join(attachmentsPath, attachmentName), downloaded.bytes, { flag: "wx" });
    } catch (error) {
      imageError = error instanceof Error ? error.message : String(error);
    }
  }

  const entry = formatCaptureGroupEntry(message, { attachmentName, imageError });
  await withFileLock(`${notePath}.lock`, async () => {
    const existingContent = await readExistingFile(notePath);
    await writeFile(notePath, buildUpdatedNoteContent(existingContent, message, entry), "utf8");
  });
  return { notePath, attachmentName };
}

export function buildUpdatedNoteContent(existingContent: string, message: CaptureMessage, entry: string): string {
  let normalizedExisting = existingContent.replace(/\r\n?/g, "\n");
  normalizedExisting = migrateLegacySourceEntries(normalizedExisting, message.pageUrl);
  normalizedExisting = linkifySourceGroupHeading(normalizedExisting, message.pageUrl, message.title);

  const group = findSourceGroup(normalizedExisting, message.pageUrl);

  if (!group) {
    return normalizedExisting + buildAppendText(normalizedExisting, `${formatCaptureSourceHeading(message)}${entry}`);
  }

  const beforeGroupEnd = normalizedExisting.slice(0, group.end);
  const afterGroupEnd = normalizedExisting.slice(group.end);
  return beforeGroupEnd + buildAppendText(beforeGroupEnd.slice(group.start), entry) + afterGroupEnd;
}

export function buildAppendText(existingContent: string, entry: string): string {
  const prefix = [];
  const normalizedExisting = existingContent.replace(/\r\n?/g, "\n");

  if (normalizedExisting.length > 0 && !normalizedExisting.endsWith("\n\n")) {
    prefix.push(normalizedExisting.endsWith("\n") ? "\n" : "\n\n");
  }

  prefix.push(buildFenceClosureText(normalizedExisting));

  return `${prefix.join("")}${entry}\n`;
}

function buildFenceClosureText(markdown: string): string {
  return hasUnclosedFence(markdown) ? "```\n\n" : "";
}

function migrateLegacySourceEntries(markdown: string, pageUrl: string): string {
  const entries = collectLegacySourceEntries(markdown, pageUrl);
  if (entries.length === 0) {
    return markdown;
  }

  const withoutLegacy = removeRanges(markdown, entries);
  const legacyBlock = entries.map((entry) => entry.entry.trimEnd()).join("\n\n") + "\n";
  const existingGroup = findSourceGroup(withoutLegacy, pageUrl);

  if (existingGroup) {
    const beforeGroupEnd = withoutLegacy.slice(0, existingGroup.end);
    const afterGroupEnd = withoutLegacy.slice(existingGroup.end);
    return beforeGroupEnd + buildAppendText(beforeGroupEnd.slice(existingGroup.start), legacyBlock) + afterGroupEnd;
  }

  const insertAt = entries[0].start;
  const before = withoutLegacy.slice(0, insertAt);
  const after = withoutLegacy.slice(insertAt);
  const separator = before.length > 0 && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
  const heading = formatCaptureSourceHeadingFromTitle(entries[0].title, pageUrl);
  return before + separator + buildFenceClosureText(before) + heading + legacyBlock + "\n" + after;
}

function collectLegacySourceEntries(markdown: string, pageUrl: string): Array<{ start: number; end: number; title: string; entry: string }> {
  const legacyPattern = /^- ([0-2]\d:[0-5]\d) \[((?:\\.|[^\]\\])*)\]\(([^)\n]+)\)\n?/gm;
  const entries = [];
  for (const match of markdown.matchAll(legacyPattern)) {
    if (match[3] !== pageUrl || match.index === undefined) {
      continue;
    }

    let end = match.index + match[0].length;
    if (markdown[end] === "\n") {
      end += 1;
    }

    entries.push({
      start: match.index,
      end,
      title: unescapeMarkdownLinkText(match[2]),
      entry: `- ${match[1]} 保存链接\n`
    });
  }

  return entries;
}

function removeRanges(markdown: string, ranges: Array<{ start: number; end: number }>): string {
  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    result += markdown.slice(cursor, range.start);
    cursor = range.end;
  }
  return result + markdown.slice(cursor);
}

function linkifySourceGroupHeading(markdown: string, pageUrl: string, fallbackTitle: string): string {
  const headingPattern = /^## (.*)\n来源：(.+)$/gm;
  for (const match of markdown.matchAll(headingPattern)) {
    if (match[2] !== pageUrl || match.index === undefined) {
      continue;
    }
    if (/^\[.*\]\([^)\n]+\)$/.test(match[1])) {
      return markdown;
    }

    const title = unescapeMarkdownText(match[1]) || fallbackTitle;
    const replacement = formatCaptureSourceHeadingFromTitle(title, pageUrl).trimEnd();
    return markdown.slice(0, match.index) + replacement + markdown.slice(match.index + match[0].length);
  }

  return markdown;
}

function findSourceGroup(markdown: string, pageUrl: string): { start: number; end: number } | undefined {
  const headingPattern = /^## .*\n来源：(.+)$/gm;
  for (const match of markdown.matchAll(headingPattern)) {
    if (match[1] !== pageUrl || match.index === undefined) {
      continue;
    }

    const start = match.index;
    const searchFrom = start + match[0].length;
    const nextHeadingIndex = markdown.slice(searchFrom).search(/^## /m);
    return {
      start,
      end: nextHeadingIndex === -1 ? markdown.length : searchFrom + nextHeadingIndex
    };
  }

  return undefined;
}

async function readExistingFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function withFileLock<T>(lockPath: string, task: () => Promise<T>): Promise<T> {
  const lock = await acquireFileLock(lockPath);
  try {
    return await task();
  } finally {
    await lock.release();
  }
}

async function acquireFileLock(lockPath: string): Promise<{ release: () => Promise<void> }> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + 5000;
  let attempts = 0;

  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      return {
        release: async () => {
          await handle.close();
          await rm(lockPath, { force: true });
        }
      };
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST" || Date.now() >= deadline) {
        throw error;
      }
      attempts += 1;
      await delay(Math.min(20 + attempts * 10, 100));
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasUnclosedFence(markdown: string): boolean {
  const matches = markdown.match(/^\s*```/gm);
  return Boolean(matches && matches.length % 2 === 1);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function unescapeMarkdownLinkText(value: string): string {
  return value.replace(/\\([\\[\]])/g, "$1");
}

function unescapeMarkdownText(value: string): string {
  return unescapeMarkdownLinkText(value).replace(/\\#/g, "#");
}

function resolveInsideVault(vaultPath: string, relativePath: string, label: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a relative path inside the vault`);
  }

  const resolved = path.resolve(vaultPath, relativePath);
  const relative = path.relative(vaultPath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the vault`);
  }
  return resolved;
}

async function defaultFetchBinary(url: string): Promise<FetchBinaryResult> {
  if (url.startsWith("data:")) {
    return decodeDataUrl(url);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? undefined
  };
}

function decodeDataUrl(url: string): FetchBinaryResult {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!match) {
    throw new Error("Invalid data URL");
  }

  const [, contentType, base64Flag, payload] = match;
  const bytes = base64Flag
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");

  return {
    bytes,
    contentType
  };
}

function buildAttachmentName(message: Extract<CaptureMessage, { type: "image" }>, contentType?: string): string {
  const extension = extensionFor(message.imageUrl, contentType);
  const stamp = compactTimestamp(message.capturedAt);
  const hash = createHash("sha256").update(`${message.imageUrl}\0${message.capturedAt}`).digest("hex").slice(0, 8);
  return `${stamp}-${hash}${extension}`;
}

function extensionFor(imageUrl: string, contentType?: string): string {
  const fromType = contentType?.split(";")[0]?.trim().toLowerCase();
  const byContentType: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif"
  };
  if (fromType && byContentType[fromType]) {
    return byContentType[fromType];
  }

  try {
    const ext = path.extname(new URL(imageUrl).pathname).toLowerCase();
    if (/^\.[a-z0-9]{1,8}$/.test(ext)) {
      return ext;
    }
  } catch {
    // Fall through to a safe default.
  }
  return ".bin";
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid capturedAt timestamp: ${isoDate}`);
  }
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function compactTimestamp(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid capturedAt timestamp: ${isoDate}`);
  }
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(
    date.getUTCMinutes()
  )}${pad(date.getUTCSeconds())}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function validateCapture(message: CaptureMessage): void {
  if (!message.title || !message.pageUrl || !message.capturedAt) {
    throw new Error("Capture message is missing required fields");
  }
  if (message.type === "selection" && !message.text) {
    throw new Error("Selection capture is missing text");
  }
  if (message.type === "image" && !message.imageUrl) {
    throw new Error("Image capture is missing imageUrl");
  }
}
