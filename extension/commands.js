import { formatBatchSaveNotification, saveCurrentWindowTabs } from "./batch-save.js";
import { captureAndSaveScreenshot } from "./screenshot.js";
import { getActiveTab, notify } from "./utils.js";

export function registerCommands(saveCapture) {
  chrome.commands?.onCommand.addListener(async (command) => {
    try {
      if (command === "capture-screenshot-area") {
        const tab = await getActiveTab();
        await captureAndSaveScreenshot(tab, saveCapture);
        notify("截图已保存到 Obsidian");
        return;
      }

      if (command === "quick-save-current-window") {
        const result = await saveCurrentWindowTabs();
        notify(formatBatchSaveNotification(result));
      }
    } catch (error) {
      notify(`快捷键操作失败：${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
