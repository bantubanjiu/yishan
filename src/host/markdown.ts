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
    return `${source}\n\n${formatFencedCodeBlock(message.text, message.codeLanguage)}\n`;
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

function formatFencedCodeBlock(text: string, explicitLanguage?: string): string {
  const content = text.replace(/\r\n?/g, "\n").trim();
  const fence = buildFence(content);
  const language = normalizeCodeLanguage(explicitLanguage) || detectCodeLanguage(content);
  return `${fence}${language}\n${content}\n${fence}`;
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
  return /(?:^|\n)\s{0,3}#{1,6}\s+\S/.test(content) || /(?:^|\n)\s*[-*+]\s+\S/.test(content) || /(?:^|\n)\s*>\s+\S/.test(content);
}

function escapeMarkdownLinkText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}
