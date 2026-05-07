import { buildPageClip } from "./page-clip.js";
import { getSelectionAsMarkdown } from "./selection-markdown.js";

export function createContextMenus() {
  chrome.contextMenus.create({
    id: "save-screenshot",
    title: "框选截图保存到 Obsidian",
    contexts: ["page", "selection", "image", "editable"]
  });
  chrome.contextMenus.create({
    id: "save-url",
    title: "保存当前页面剪藏到 Obsidian",
    contexts: ["page"]
  });
  chrome.contextMenus.create({
    id: "save-selection",
    title: "保存选中文本到 Obsidian",
    contexts: ["selection", "editable"]
  });
  chrome.contextMenus.create({
    id: "save-image",
    title: "保存图片到 Obsidian",
    contexts: ["image"]
  });
}

export async function buildCaptureMessage(info, tab, config, buildScreenshotCapture) {
  const base = {
    title: tab?.title || "Untitled",
    pageUrl: info.pageUrl || tab?.url || "",
    capturedAt: new Date().toISOString()
  };

  if (info.menuItemId === "save-url") {
    return buildPageClip(tab);
  }

  if (info.menuItemId === "save-selection") {
    const selection = await getSelectionAsMarkdown(tab?.id, info.selectionText || "", config.selectionSaveMode);
    const text = selection.text || info.selectionText || "";
    if (!text.trim()) {
      throw new Error("没有检测到选中文本");
    }
    return {
      type: "selection",
      ...base,
      text,
      markdown: selection.markdown || text,
      codeLanguage: selection.codeLanguage || undefined
    };
  }

  if (info.menuItemId === "save-image") {
    return {
      type: "image",
      ...base,
      imageUrl: info.srcUrl || ""
    };
  }

  if (info.menuItemId === "save-screenshot") {
    return buildScreenshotCapture(tab);
  }

  throw new Error(`Unsupported menu item: ${info.menuItemId}`);
}
