import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatCaptureEntry } from "./markdown.ts";
import type { AppConfig, CaptureMessage } from "./types.ts";

const IMAGE_DOWNLOAD_TIMEOUT_MS = 10_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

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
      validateDownloadedImage(downloaded);
      attachmentName = buildAttachmentName(message, downloaded.contentType);
      await writeFile(path.join(attachmentsPath, attachmentName), downloaded.bytes, { flag: "wx" });
    } catch (error) {
      imageError = error instanceof Error ? error.message : String(error);
    }
  }

  const entry = formatCaptureEntry(message, { attachmentName, imageError });
  await withFileLock(`${notePath}.lock`, async () => {
    const existingContent = await readExistingFile(notePath);
    await writeFile(notePath, buildUpdatedNoteContent(existingContent, message, entry), "utf8");
  });
  return { notePath, attachmentName };
}

export function buildUpdatedNoteContent(existingContent: string, _message: CaptureMessage, entry: string): string {
  const normalizedExisting = existingContent.replace(/\r\n?/g, "\n");
  return normalizedExisting + buildAppendText(normalizedExisting, entry);
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    if (!isImageContentType(contentType)) {
      throw new Error("响应不是图片内容");
    }

    const contentLength = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new Error("图片体积超过 20MB");
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("图片体积超过 20MB");
    }

    return { bytes, contentType };
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("图片下载超时");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function decodeDataUrl(url: string): FetchBinaryResult {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!match) {
    throw new Error("Invalid data URL");
  }

  const [, contentType, base64Flag, payload] = match;
  if (!isImageContentType(contentType)) {
    throw new Error("Invalid data URL");
  }
  const bytes = base64Flag
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("图片体积超过 20MB");
  }

  return {
    bytes,
    contentType
  };
}

function validateDownloadedImage(downloaded: FetchBinaryResult): void {
  if (!isImageContentType(downloaded.contentType)) {
    throw new Error("响应不是图片内容");
  }
  if (downloaded.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("图片体积超过 20MB");
  }
}

function isImageContentType(contentType?: string): boolean {
  return typeof contentType === "string" && contentType.split(";")[0].trim().toLowerCase().startsWith("image/");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function compactTimestamp(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid capturedAt timestamp: ${isoDate}`);
  }
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(
    date.getSeconds()
  )}`;
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
