import { formatBatchSaveNotification, saveCurrentWindowTabs } from "./batch-save.js";
import { captureAndSaveScreenshot } from "./screenshot.js";
import { getActiveTab, notify } from "./utils.js";

export function registerCommands(saveCapture) {
  chrome.commands?.onCommand.addListener(async (command, tab) => {
    try {
      if (command === "capture-screenshot-area") {
        const activeTab = tab?.id ? tab : await getActiveTab();
        const response = await captureAndSaveScreenshot(activeTab, saveCapture);
        notify("截图已保存到 Obsidian", { isWarning: hasImageFailures(response) });
        return;
      }

      if (command === "quick-save-current-window") {
        const result = await saveCurrentWindowTabs();
        notify(formatBatchSaveNotification(result), { isWarning: result.failed > 0 });
      }
    } catch (error) {
      notify(`快捷键操作失败：${error instanceof Error ? error.message : String(error)}`, { isError: true });
    }
  });
}

function hasImageFailures(response) {
  return Array.isArray(response?.imageFailures) && response.imageFailures.length > 0;
}
