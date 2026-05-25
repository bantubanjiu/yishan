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

const ACTION_FEEDBACK_CLEAR_DELAY_MS = 3_500;
let actionFeedbackGeneration = 0;

export function notify(message, options = {}) {
  const isError = options.isError === true;
  const isWarning = options.isWarning === true;
  showActionFeedback(message, { isError, isWarning });
  chrome.notifications?.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: isError ? "移山保存失败" : "移山",
    message
  }, () => {
    if (chrome.runtime.lastError) {
      console.warn("Notification failed:", chrome.runtime.lastError.message);
    }
  });
}

function showActionFeedback(message, { isError = false, isWarning = false } = {}) {
  if (!chrome.action) {
    return;
  }

  const feedback = isError
    ? { text: "!", color: "#dc2626", titlePrefix: "移山保存失败" }
    : isWarning
      ? { text: "!", color: "#f59e0b", titlePrefix: "移山保存有警告" }
      : { text: "✓", color: "#16a34a", titlePrefix: "移山保存成功" };

  chrome.action.setBadgeBackgroundColor?.({ color: feedback.color });
  chrome.action.setBadgeText?.({ text: feedback.text });
  chrome.action.setTitle?.({ title: `${feedback.titlePrefix}：${message}` });
  if (chrome.action.setBadgeText) {
    const generation = ++actionFeedbackGeneration;
    setTimeout(() => {
      if (generation !== actionFeedbackGeneration) {
        return;
      }
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle?.({ title: "移山" });
    }, ACTION_FEEDBACK_CLEAR_DELAY_MS);
  }
}
