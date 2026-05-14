import { saveCurrentWindowTabs } from "./batch-save.js";
import { normalizeConfig, normalizeConfigResponse } from "./config-client.js";
import { DEFAULT_SETTINGS } from "./constants.js";
import { registerCommands } from "./commands.js";
import { buildCaptureMessage, createContextMenus } from "./context-menu.js";
import { buildPageClip } from "./page-clip.js";
import { syncSelectionGestureForActiveTab, syncSelectionGestureForTab } from "./gesture.js";
import { saveCapture, sendNativeMessage } from "./native-client.js";
import { captureAndSaveScreenshot, buildScreenshotCapture } from "./screenshot.js";
import { getSelectionAsMarkdown } from "./selection-markdown.js";
import { getActiveTab, isRecord, notify } from "./utils.js";

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
  void syncSelectionGestureForActiveTab();
});

chrome.runtime.onStartup?.addListener(() => {
  void syncSelectionGestureForActiveTab();
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void syncSelectionGestureForTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" || changeInfo.status === "complete" || typeof changeInfo.url === "string") {
    void syncSelectionGestureForTab(tabId, tab);
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  void syncSelectionGestureForActiveTab();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const config = await loadConfigForSelection();
    const capture = await buildCaptureMessage(info, tab, config, buildScreenshotCapture);
    await saveCapture(capture);
    notify("已保存到 Obsidian");
  } catch (error) {
    notify(`保存失败：${error instanceof Error ? error.message : String(error)}`);
  }
});

registerCommands(saveCapture);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleRuntimeMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  return true;
});

async function handleRuntimeMessage(message, sender) {
  if (!isRecord(message) || typeof message.type !== "string") {
    return { ok: false, error: "Runtime message must include a type" };
  }

  if (message.type === "get-default-settings") {
    return {
      ok: true,
      settings: { ...DEFAULT_SETTINGS }
    };
  }

  if (message.type === "get-config") {
    return normalizeConfigResponse(await sendNativeMessage({ type: "get-config" }));
  }

  if (message.type === "set-config") {
    const response = await sendNativeMessage({ type: "set-config", config: normalizeConfig(message.config || {}) });
    await syncSelectionGestureForActiveTab();
    return response;
  }

  if (message.type === "pick-folder") {
    return sendNativeMessage({ ...message, type: "pick-folder" });
  }

  if (message.type === "open-path") {
    return sendNativeMessage({ type: "open-path", target: message.target });
  }

  if (message.type === "save-current-window") {
    return saveCurrentWindowTabs();
  }

  if (message.type === "save-current-page") {
    const tab = await getActiveTab();
    const capture = await buildPageClip(tab);
    const response = await saveCapture(capture);
    return { ok: true, response };
  }

  if (message.type === "capture-screenshot") {
    const tab = await getActiveTab();
    const response = await captureAndSaveScreenshot(tab, saveCapture);
    return { ok: true, response };
  }

  if (message.type === "capture-viewport-screenshot") {
    const tab = await getActiveTab();
    const response = await captureAndSaveScreenshot(tab, saveCapture, "viewport");
    return { ok: true, response };
  }

  if (message.type === "open-shortcuts") {
    await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    return { ok: true };
  }

  if (message.type === "save-selection-from-gesture") {
    const tab = sender.tab || {};
    const text = typeof message.text === "string" ? message.text : "";
    const config = await loadConfigForSelection();
    const selection = await getSelectionAsMarkdown(sender.tab?.id, text, config.selectionSaveMode);
    const markdown = typeof message.markdown === "string" ? message.markdown : selection.markdown || text;
    if (!text.trim() && !markdown.trim()) {
      return { ok: false, error: "没有检测到选中文本" };
    }
    const response = await saveCapture({
      type: "selection",
      title: tab?.title || "Untitled",
      pageUrl: tab?.url || message.pageUrl || "",
      text,
      markdown,
      codeLanguage: typeof message.codeLanguage === "string" ? message.codeLanguage || undefined : selection.codeLanguage || undefined,
      capturedAt: new Date().toISOString()
    });
    notify("已保存选中文本到 Obsidian");
    return { ok: true, response };
  }

  return { ok: false, error: `Unsupported runtime message: ${message.type}` };
}

async function loadConfigForSelection() {
  try {
    const response = await sendNativeMessage({ type: "get-config" });
    return normalizeConfig(response?.config || {});
  } catch {
    return normalizeConfig({});
  }
}

