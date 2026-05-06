import { createHash } from "node:crypto";
import { mkdir, appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatCaptureEntry } from "./markdown.ts";
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

  const entry = formatCaptureEntry(message, { attachmentName, imageError });
  const existingContent = await readExistingFile(notePath);
  await appendFile(notePath, buildAppendText(existingContent, entry), "utf8");
  return { notePath, attachmentName };
}

export function buildAppendText(existingContent: string, entry: string): string {
  const prefix = [];
  const normalizedExisting = existingContent.replace(/\r\n?/g, "\n");

  if (normalizedExisting.length > 0 && !normalizedExisting.endsWith("\n\n")) {
    prefix.push(normalizedExisting.endsWith("\n") ? "\n" : "\n\n");
  }

  if (hasUnclosedFence(normalizedExisting)) {
    prefix.push("```\n\n");
  }

  return `${prefix.join("")}${entry}\n`;
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

function hasUnclosedFence(markdown: string): boolean {
  const matches = markdown.match(/^\s*```/gm);
  return Boolean(matches && matches.length % 2 === 1);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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
