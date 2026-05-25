import type { CaptureMessage } from "./types.ts";

export type FormatCaptureOptions = {
  attachmentName?: string;
  imageError?: string;
  standalone?: boolean;
};

export function formatCaptureEntry(
  message: CaptureMessage,
  options: FormatCaptureOptions = {}
): string {
  if (message.type === "page" || options.standalone) {
    return formatPageDocument(message);
  }

  return `${formatPageGroupHeading(message)}\n\n${formatCaptureSubentry(message, options)}`;
}

export function formatPageGroupHeading(message: Exclude<CaptureMessage, { type: "page" }>): string {
  return `#### [${escapeMarkdownLinkText(message.title)}](${message.pageUrl})`;
}

export function formatCaptureSubentry(message: Exclude<CaptureMessage, { type: "page" }>, options: FormatCaptureOptions = {}): string {
  const timestamp = formatTime(message.capturedAt);

  if (message.type === "url") {
    return `- ${timestamp} 保存链接\n`;
  }

  if (message.type === "selection") {
    if (hasRichSelectionMarkdown(message)) {
      return `- ${timestamp} 富文本摘录\n\n${normalizeMarkdown(message.markdown ?? "")}\n`;
    }
    return `- ${timestamp} 文字摘录\n\n${formatSelectionText(message.text, message.codeLanguage)}\n`;
  }

  const lines = [`- ${timestamp} ${message.imageUrl.startsWith("data:image/") ? "截图" : "图片"}`, ""];
  if (options.attachmentName) {
    lines.push(`![[${options.attachmentName}]]`);
  } else if (options.imageError) {
    lines.push(`图片下载失败：${options.imageError}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatPageDocument(message: CaptureMessage): string {
  if (message.type !== "page") {
    throw new Error("Standalone markdown documents require a page capture");
  }

  const markdown = message.markdown.replace(/\r\n?/g, "\n").trim();
  return [
    "---",
    `title: ${yamlString(message.title)}`,
    `source: ${yamlString(message.pageUrl)}`,
    `clipped_at: ${yamlString(message.capturedAt)}`,
    "---",
    "",
    markdown,
    ""
  ].join("\n");
}

function formatTime(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid capturedAt timestamp: ${isoDate}`);
  }
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatFencedCodeBlock(text: string, explicitLanguage?: string): string {
  const content = text.replace(/\r\n?/g, "\n").trim();
  const fence = buildFence(content);
  const language = normalizeCodeLanguage(explicitLanguage) || detectCodeLanguage(content);
  return `${fence}${language}\n${content}\n${fence}`;
}

function formatSelectionText(text: string, explicitLanguage?: string): string {
  const content = text.replace(/\r\n?/g, "\n").trim();
  if (!content) {
    return "";
  }

  if (shouldFenceSelectionText(content, explicitLanguage)) {
    return formatFencedCodeBlock(content, explicitLanguage);
  }

  return content;
}

function shouldFenceSelectionText(content: string, explicitLanguage?: string): boolean {
  return Boolean(normalizeCodeLanguage(explicitLanguage)) || detectCodeLanguage(content) !== "text" || content.includes("```");
}

function hasRichSelectionMarkdown(message: Extract<CaptureMessage, { type: "selection" }>): boolean {
  const markdown = normalizeMarkdown(message.markdown ?? "");
  if (!markdown) {
    return false;
  }
  return (
    markdown !== normalizeMarkdown(message.text) &&
    markdown !== normalizePlainSelectionText(message.text) &&
    hasRichMarkdownFormatting(markdown)
  );
}

function hasRichMarkdownFormatting(markdown: string): boolean {
  return /(?:^|\n)\s{0,3}#{1,6}\s+\S/.test(markdown) ||
    /(?:^|\n)\s*[-*+]\s+\S/.test(markdown) ||
    /(?:^|\n)\s*\d+\.\s+\S/.test(markdown) ||
    /(?:^|\n)\s*>\s+\S/.test(markdown) ||
    /\*\*[^*\n][\s\S]*?\*\*/.test(markdown) ||
    /__[^_\n][\s\S]*?__/.test(markdown) ||
    /(?:^|[^*])\*(?!\*)[^*\n]+\*(?!\*)/.test(markdown) ||
    /(?:^|[^_])_(?!_)[^_\n]+_(?!_)/.test(markdown) ||
    /`[^`\n]+`/.test(markdown) ||
    /~~[^~\n]+~~/.test(markdown) ||
    /!\[[^\]]*]\([^)]+\)/.test(markdown) ||
    /\[[^\]]+]\([^)]+\)/.test(markdown) ||
    /(?:^|\n)\s*```/.test(markdown);
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n").trim();
}

function normalizePlainSelectionText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function buildFence(content: string): string {
  const longestBacktickRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
  return "`".repeat(Math.max(3, longestBacktickRun + 1));
}

function normalizeCodeLanguage(value?: string): string {
  const normalized = value?.trim().toLowerCase().replace(/^language-/, "").replace(/^lang-/, "");
  if (!normalized || !/^[a-z0-9_+#.-]{1,32}$/.test(normalized)) {
    return "";
  }

  const aliases: Record<string, string> = {
    bash: "sh",
    shell: "sh",
    shellsession: "sh",
    zsh: "sh",
    powershell: "powershell",
    ps1: "powershell",
    javascript: "js",
    jsx: "jsx",
    node: "js",
    typescript: "ts",
    tsx: "tsx",
    py: "python",
    python3: "python",
    md: "markdown",
    yml: "yaml",
    htm: "html"
  };

  return aliases[normalized] || normalized;
}

function detectCodeLanguage(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "text";
  }

  if (looksLikeJson(trimmed)) {
    return "json";
  }
  if (looksLikeHtml(trimmed)) {
    return "html";
  }
  if (looksLikeCss(trimmed)) {
    return "css";
  }
  if (looksLikeTypeScript(trimmed)) {
    return "ts";
  }
  if (looksLikeJavaScript(trimmed)) {
    return "js";
  }
  if (looksLikePython(trimmed)) {
    return "python";
  }
  if (looksLikeShell(trimmed)) {
    return "sh";
  }
  if (looksLikeMarkdown(trimmed)) {
    return "markdown";
  }

  return "text";
}

function looksLikeJson(content: string): boolean {
  if (!/^[\[{]/.test(content)) {
    return false;
  }

  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

function looksLikeHtml(content: string): boolean {
  return /^<!doctype\s+html/i.test(content) || /<\/?[a-z][\w:-]*(?:\s+[^<>]*)?>/i.test(content);
}

function looksLikeCss(content: string): boolean {
  return /(?:^|\n)\s*(?:[.#]?[a-z][\w-]*|\[[^\]]+\]|:[\w-]+)[^{\n]*\{\s*[\w-]+\s*:/i.test(content);
}

function looksLikeTypeScript(content: string): boolean {
  return /\b(?:interface|type)\s+[A-Z_a-z]\w*\b/.test(content) || /:\s*(?:string|number|boolean|unknown|Record<|Array<|\w+\[\])\b/.test(content);
}

function looksLikeJavaScript(content: string): boolean {
  return /\b(?:const|let|var|function|import|export|return|async|await)\b/.test(content) && /[;{}=]|=>/.test(content);
}

function looksLikePython(content: string): boolean {
  return /(?:^|\n)\s*(?:def|class)\s+\w+.*:\s*(?:\n|$)/.test(content) || /(?:^|\n)\s*(?:from\s+\w+\s+import|import\s+\w+)/.test(content);
}

function looksLikeShell(content: string): boolean {
  return /(?:^|\n)\s*(?:npm|pnpm|yarn|git|cd|ls|mkdir|rm|cp|mv|echo|curl|wget|node|python|pip|docker)\s+/.test(content) || /^#!\/(?:usr\/bin\/env\s+)?(?:bash|sh|zsh)/.test(content);
}

function looksLikeMarkdown(content: string): boolean {
  return /(?:^|\n)\s{0,3}#{1,6}\s+\S/.test(content) ||
    /(?:^|\n)\s*[-*+]\s+\S/.test(content) ||
    /(?:^|\n)\s*>\s+\S/.test(content) ||
    /(?:^|\n)\s*```/.test(content);
}

function escapeMarkdownLinkText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}
