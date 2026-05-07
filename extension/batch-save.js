import { sendNativeMessage } from "./native-client.js";
import { buildUrlCapture, isOrdinaryTab } from "./utils.js";

export async function saveCurrentWindowTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const candidates = tabs.filter(isOrdinaryTab);
  const captures = candidates.map(buildUrlCapture);
  const response = await sendNativeMessage({ type: "batch-save-tabs", tabs: captures });
  if (!response?.ok) {
    throw new Error(response?.error || "批量保存失败");
  }

  return {
    ok: Number(response.failed || 0) === 0,
    total: tabs.length,
    attempted: candidates.length,
    saved: Number(response.saved || 0),
    skipped: tabs.length - candidates.length,
    failed: Number(response.failed || 0),
    failures: response.failures || []
  };
}

export function formatBatchSaveNotification(result) {
  if (result.attempted === 0) {
    return "当前窗口没有可保存的普通标签页";
  }
  if (result.failed > 0) {
    return `已保存 ${result.saved}/${result.attempted} 个标签页，失败 ${result.failed} 个`;
  }
  return `已保存当前窗口 ${result.saved} 个标签页到 Obsidian`;
}
