chrome.runtime.sendMessage({ type: "sync-selection-gesture" }, () => {
  void chrome.runtime.lastError;
});
