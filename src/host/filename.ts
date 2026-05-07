import { createHash } from "node:crypto";
import path from "node:path";

import type { CaptureMessage } from "./types.ts";

export function buildAttachmentName(message: Extract<CaptureMessage, { type: "image" }>, contentType?: string): string {
  const extension = extensionFor(message.imageUrl, contentType);
  const stamp = compactTimestamp(message.capturedAt);
  const hash = createHash("sha256").update(`${message.imageUrl}\0${message.capturedAt}`).digest("hex").slice(0, 8);
  return `${stamp}-${hash}${extension}`;
}

export function buildPageAttachmentName(
  message: Extract<CaptureMessage, { type: "page" }>,
  imageUrl: string,
  contentType?: string
): string {
  const extension = extensionFor(imageUrl, contentType);
  const stamp = compactTimestamp(message.capturedAt);
  const hash = createHash("sha256").update(`${message.pageUrl}\0${imageUrl}\0${message.capturedAt}`).digest("hex").slice(0, 8);
  return `${stamp}-${hash}${extension}`;
}

export function buildPageNoteBaseName(message: Extract<CaptureMessage, { type: "page" }>): string {
  return `${safeFileStem(message.title)}-${compactTimestamp(message.capturedAt)}`;
}

export function formatDate(isoDate: string): string {
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

function safeFileStem(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return (normalized || "Untitled").slice(0, 80);
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

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
