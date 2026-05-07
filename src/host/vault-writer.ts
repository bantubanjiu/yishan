import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { errorMessage, isNodeError } from "./errors.ts";
import { buildAttachmentName, formatDate } from "./filename.ts";
import { defaultFetchBinary, type FetchBinaryResult, validateDownloadedImage } from "./image-downloader.ts";
import { formatCaptureEntry } from "./markdown-renderer.ts";
import type { AppConfig, CaptureMessage } from "./types.ts";

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
      imageError = errorMessage(error);
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
}
