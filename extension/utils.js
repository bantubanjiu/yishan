import { ORDINARY_TAB_PROTOCOLS } from "./constants.js";

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("没有找到当前活动标签页");
  }
  return tab;
}

export function isOrdinaryTab(tab) {
  if (!tab?.url) {
    return false;
  }
  try {
    return ORDINARY_TAB_PROTOCOLS.has(new URL(tab.url).protocol);
  } catch {
    return false;
  }
}

export function buildUrlCapture(tab) {
  if (!tab?.url) {
    throw new Error("当前标签页没有可保存的 URL");
  }
  return {
    type: "url",
    title: tab.title || "Untitled",
    pageUrl: tab.url,
    capturedAt: new Date().toISOString()
  };
}

export function normalizeSelectionModifier(value) {
  return ["Alt", "Ctrl", "Shift", "Meta"].includes(value) ? value : "Alt";
}

export function notify(message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "移山",
    message
  }, () => {
    if (chrome.runtime.lastError) {
      console.warn("Notification failed:", chrome.runtime.lastError.message);
    }
  });
}
