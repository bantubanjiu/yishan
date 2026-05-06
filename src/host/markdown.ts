import type { CaptureMessage } from "./types.ts";

export type FormatCaptureOptions = {
  attachmentName?: string;
  imageError?: string;
};

export function formatCaptureEntry(
  message: CaptureMessage,
  options: FormatCaptureOptions = {}
): string {
  const source = `- ${formatTime(message.capturedAt)} [${escapeMarkdownLinkText(message.title)}](${message.pageUrl})`;

  if (message.type === "url") {
    return `${source}\n`;
  }

  if (message.type === "selection") {
    return `${source}\n\n${formatFencedCodeBlock(message.text)}\n`;
  }

  const lines = [source];
  if (options.attachmentName) {
    lines.push(`  ![[${options.attachmentName}]]`);
  } else if (options.imageError) {
    lines.push(`  图片下载失败：${options.imageError}`);
  }
  if (!message.imageUrl.startsWith("data:")) {
    lines.push(`  来源图片：${message.imageUrl}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid capturedAt timestamp: ${isoDate}`);
  }
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatFencedCodeBlock(text: string): string {
  const content = text.replace(/\r\n?/g, "\n").trim();
  const fence = buildFence(content);
  return `${fence}text\n${content}\n${fence}`;
}

function buildFence(content: string): string {
  const longestBacktickRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
  return "`".repeat(Math.max(3, longestBacktickRun + 1));
}

function escapeMarkdownLinkText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}
