import { mkdir, open, readFile, rm, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";

import { errorMessage, isNodeError } from "./errors.ts";
import { buildAttachmentName, buildPageAttachmentName, buildPageNoteBaseName, formatDate } from "./filename.ts";
import { defaultFetchBinary, type FetchBinaryResult, validateDownloadedImage } from "./image-downloader.ts";
import { formatCaptureEntry, formatCaptureSubentry, formatPageGroupHeading } from "./markdown-renderer.ts";
import type { AppConfig, CaptureMessage } from "./types.ts";

export type VaultWriterDeps = {
  fetchBinary?: (url: string) => Promise<FetchBinaryResult>;
};

export type VaultWriteResult = {
  notePath: string;
  attachmentName?: string;
  attachments?: string[];
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

  if (message.type === "page") {
    return writePageCaptureToVault(message, inboxPath, attachmentsPath, deps);
  }

  const notePath = path.join(inboxPath, `${formatDate(message.capturedAt)}.md`);
  let attachmentName: string | undefined;
  let imageError: string | undefined;

  if (message.type === "image") {
    try {
      await mkdir(attachmentsPath, { recursive: true });
      const fetchBinary = deps.fetchBinary ?? defaultFetchBinary;
      const downloaded = await fetchBinary(message.imageUrl);
      validateDownloadedImage(downloaded);
      attachmentName = buildAttachmentName(message, downloaded.contentType);
      await writeFile(path.join(attachmentsPath, attachmentName), downloaded.bytes, { flag: "wx" });
    } catch (error) {
      imageError = errorMessage(error);
    }
  }

  const entry = formatCaptureSubentry(message, { attachmentName, imageError });
  await withFileLock(`${notePath}.lock`, async () => {
    const existingContent = await readExistingFile(notePath);
    await writeFile(notePath, buildUpdatedNoteContent(existingContent, message, entry), "utf8");
  });
  return { notePath, attachmentName };
}

async function writePageCaptureToVault(
  message: Extract<CaptureMessage, { type: "page" }>,
  inboxPath: string,
  attachmentsPath: string,
  deps: VaultWriterDeps
): Promise<VaultWriteResult> {
  let markdown = message.markdown;
  const attachments: string[] = [];
  const imageErrors: string[] = [];

  if (message.images?.length) {
    await mkdir(attachmentsPath, { recursive: true });
    const fetchBinary = deps.fetchBinary ?? defaultFetchBinary;

    for (const image of message.images) {
      try {
        const downloaded = await fetchBinary(image.url);
        validateDownloadedImage(downloaded);
        const attachmentName = buildPageAttachmentName(message, image.url, downloaded.contentType);
        await writeAttachmentWithoutCollision(path.join(attachmentsPath, attachmentName), downloaded.bytes);
        attachments.push(attachmentName);
        markdown = replaceMarkdownImageReferences(markdown, image.url, attachmentName);
      } catch (error) {
        imageErrors.push(`[${image.alt || image.url}](${image.url}) - ${errorMessage(error)}`);
      }
    }
  }

  if (imageErrors.length > 0) {
    markdown = `${markdown.trim()}\n\n${imageErrors.map((error) => `> 图片本地化失败：${error}`).join("\n")}`;
  }

  const reservedNote = await reserveStandaloneNote(inboxPath, buildPageNoteBaseName(message));
  try {
    const entry = formatCaptureEntry({ ...message, markdown }, { standalone: true });
    await reservedNote.handle.writeFile(entry, "utf8");
  } finally {
    await reservedNote.handle.close();
  }
  return { notePath: reservedNote.notePath, attachments };
}

export function buildUpdatedNoteContent(existingContent: string, message: CaptureMessage, entry: string): string {
  const normalizedExisting = existingContent.replace(/\r\n?/g, "\n");
  if (message.type === "page") {
    return normalizedExisting + buildAppendText(normalizedExisting, entry);
  }

  const insertion = insertIntoExistingPageGroup(normalizedExisting, message, entry);
  if (insertion !== undefined) {
    return insertion;
  }

  const groupedEntry = `${formatPageGroupHeading(message)}\n\n${entry}`;
  return normalizedExisting + buildAppendText(normalizedExisting, groupedEntry);
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

function insertIntoExistingPageGroup(
  existingContent: string,
  message: Exclude<CaptureMessage, { type: "page" }>,
  entry: string
): string | undefined {
  const heading = findPageGroupHeading(existingContent, message.pageUrl);
  if (!heading) {
    return undefined;
  }

  const groupEnd = findNextPageGroupStart(existingContent, heading.end);
  const beforeGroup = existingContent.slice(0, groupEnd);
  const afterGroup = existingContent.slice(groupEnd);
  return beforeGroup + buildAppendText(beforeGroup, entry) + afterGroup;
}

function findPageGroupHeading(markdown: string, pageUrl: string): { start: number; end: number } | undefined {
  const headingPattern = /^## \[(?:[^\]\\]|\\.)*\]\(([^)\n]+)\)[ \t]*$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(markdown)) !== null) {
    if (match[1] === pageUrl) {
      return {
        start: match.index,
        end: match.index + match[0].length
      };
    }
  }
  return undefined;
}

function findNextPageGroupStart(markdown: string, fromIndex: number): number {
  const nextHeadingPattern = /^## \[(?:[^\]\\]|\\.)*\]\([^)]+\)[ \t]*$/gm;
  nextHeadingPattern.lastIndex = fromIndex;
  const match = nextHeadingPattern.exec(markdown);
  return match ? match.index : markdown.length;
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

async function reserveStandaloneNote(directory: string, baseName: string): Promise<{ notePath: string; handle: FileHandle }> {
  let index = 0;
  while (true) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const notePath = path.join(directory, `${baseName}${suffix}.md`);
    try {
      const handle = await open(notePath, "wx");
      return { notePath, handle };
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }
      index += 1;
    }
  }
}

function replaceMarkdownImageReferences(markdown: string, imageUrl: string, attachmentName: string): string {
  const escapedUrl = escapeRegExp(imageUrl);
  const encodedUrl = escapeRegExp(encodeURI(imageUrl));
  const pattern = new RegExp(`!\\[([^\\]]*)\\]\\((${escapedUrl}|${encodedUrl})(?:\\s+["'][^"']*["'])?\\)`, "g");
  return markdown.replace(pattern, `![[${attachmentName}]]`);
}

async function writeAttachmentWithoutCollision(filePath: string, bytes: Uint8Array): Promise<void> {
  try {
    await writeFile(filePath, bytes, { flag: "wx" });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") {
      throw error;
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  if (message.type === "page" && !message.markdown?.trim()) {
    throw new Error("Page capture is missing markdown");
  }
}
