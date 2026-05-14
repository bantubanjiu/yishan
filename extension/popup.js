const HOST_NAME = "com.local.obsidian_web_clipper";
const DEFAULT_CONFIG = {
  vaultPath: "",
  selectionModifier: "Alt",
  selectionGestureEnabled: false,
  selectionSaveMode: "plain"
};

const controls = {
  saveCurrentPage: document.querySelector("#saveCurrentPage"),
  saveCurrentWindow: document.querySelector("#saveCurrentWindow"),
  captureScreenshot: document.querySelector("#captureScreenshot"),
  captureViewport: document.querySelector("#captureViewport"),
  openTodayInbox: document.querySelector("#openTodayInbox"),
  openOptions: document.querySelector("#openOptions"),
  reload: document.querySelector("#reload"),
  openShortcuts: document.querySelector("#openShortcuts")
};

const summary = {
  vaultState: document.querySelector("#vaultState"),
  gestureSummary: document.querySelector("#gestureSummary"),
  modeSummary: document.querySelector("#modeSummary"),
  shortcutSummary: document.querySelector("#shortcutSummary")
};

const statusEl = document.querySelector("#status");
const allButtons = Array.from(document.querySelectorAll("button"));
let currentConfig = { ...DEFAULT_CONFIG };

controls.saveCurrentPage.addEventListener("click", () => runSaveAction("正在保存当前页面...", saveCurrentPage));
controls.saveCurrentWindow.addEventListener("click", () => runSaveAction("正在保存当前窗口标签...", saveCurrentWindow));
controls.captureScreenshot.addEventListener("click", () => runSaveAction("请在页面中拖拽选择截图区域...", captureScreenshot));
controls.captureViewport.addEventListener("click", () => runSaveAction("正在保存当前视口...", captureViewport));
controls.openTodayInbox.addEventListener("click", () => runAction("正在打开今天 Inbox...", () => openPathTarget("today-inbox")));
controls.openOptions.addEventListener("click", () => runAction("正在打开完整设置...", openOptionsPage));
controls.reload.addEventListener("click", () => runAction("正在读取状态...", loadConfig));
controls.openShortcuts.addEventListener("click", () => runAction("正在打开快捷键设置...", openShortcuts));

await runAction("正在读取状态...", loadConfig, { quietSuccess: true });

async function saveCurrentPage() {
  const response = await sendAction({ type: "save-current-page" });
  assertOk(response, "保存当前页面失败");
  setStatus("已保存：当前页面 → Obsidian。");
}

async function saveCurrentWindow() {
  const response = await sendAction({ type: "save-current-window" }, () => fallbackSaveCurrentWindow());
  assertOk(response, "保存窗口失败");
  if (typeof response.saved === "number" && typeof response.attempted === "number") {
    const failed = Number(response.failed || 0);
    setStatus(
      failed > 0 ? `已保存 ${response.saved}/${response.attempted} 个标签，失败 ${failed} 个。` : `已保存：当前窗口 ${response.saved} 个标签。`,
      failed > 0
    );
    return;
  }
  setStatus("已保存：当前窗口标签。");
}

async function captureScreenshot() {
  sendRuntimeMessage({ type: "capture-screenshot" }).catch((error) => {
    notifySaveResult(error instanceof Error ? error.message : String(error), true);
  });
  window.close();
}

async function captureViewport() {
  const response = await sendAction({ type: "capture-viewport-screenshot" });
  assertOk(response, "当前视口截图失败");
  setStatus("已保存：当前视口截图 → Obsidian。");
}

async function loadConfig() {
  const response = await sendAction({ type: "get-config" }, () => sendNativeMessage({ type: "get-config" }));
  assertOk(response, "读取失败");
  currentConfig = normalizeConfig(response.config || {});
  renderConfigSummary();
  await renderShortcutSummary();
  setStatus("状态已刷新。");
}

async function openPathTarget(target) {
  const response = await sendAction({ type: "open-path", target }, () => sendNativeMessage({ type: "open-path", target }));
  assertOk(response, "打开路径失败");
  setStatus("已请求系统打开路径。");
}

async function openOptionsPage() {
  if (chrome.runtime.openOptionsPage) {
    await chrome.runtime.openOptionsPage();
    setStatus("已打开完整设置。");
    return;
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
  setStatus("已打开完整设置。");
}

async function openShortcuts() {
  const response = await sendAction({ type: "open-shortcuts" }, fallbackOpenShortcuts);
  assertOk(response, "打开快捷键设置失败");
  setStatus("已打开 Chrome 快捷键设置。");
}

function renderConfigSummary() {
  const vaultPath = currentConfig.vaultPath.trim();
  summary.vaultState.textContent = vaultPath ? `已配置：${formatPathSummary(vaultPath)}` : "未配置，请打开完整设置";
  summary.vaultState.classList.toggle("warning", !vaultPath);
  summary.gestureSummary.textContent = currentConfig.selectionGestureEnabled
    ? `已开启，长按 ${currentConfig.selectionModifier} 后拖选`
    : "关闭，可在完整设置开启";
  summary.modeSummary.textContent = currentConfig.selectionSaveMode === "rich" ? "富 Markdown" : "安全纯文本";
}

async function renderShortcutSummary() {
  try {
    const commands = await chrome.commands.getAll();
    const saveTabs = findCommandShortcut(commands, "quick-save-current-window");
    const screenshot = findCommandShortcut(commands, "capture-screenshot-area");
    const missing = [saveTabs, screenshot].filter((shortcut) => !shortcut).length;
    summary.shortcutSummary.textContent = missing
      ? `${missing} 个未绑定或被占用`
      : `标签 ${saveTabs}；截图 ${screenshot}`;
    summary.shortcutSummary.classList.toggle("warning", missing > 0);
  } catch {
    summary.shortcutSummary.textContent = "无法读取快捷键状态";
    summary.shortcutSummary.classList.add("warning");
  }
}

function findCommandShortcut(commands, name) {
  const command = commands.find((item) => item.name === name);
  return typeof command?.shortcut === "string" ? command.shortcut : "";
}

function normalizeConfig(config) {
  return {
    vaultPath: typeof config.vaultPath === "string" ? config.vaultPath : DEFAULT_CONFIG.vaultPath,
    selectionModifier: normalizeSelectionModifier(config.selectionModifier || config.gestureModifier),
    selectionGestureEnabled: config.selectionGestureEnabled === true,
    selectionSaveMode: config.selectionSaveMode === "rich" ? "rich" : DEFAULT_CONFIG.selectionSaveMode
  };
}

function formatPathSummary(path) {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || normalized;
}

async function fallbackSaveCurrentWindow() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const candidates = tabs.filter(isOrdinaryTab);
  const response = await sendNativeMessage({ type: "batch-save-tabs", tabs: candidates.map(buildUrlCapture) });
  assertOk(response, "保存失败");

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

function buildUrlCapture(tab) {
  return {
    type: "url",
    title: tab.title || "Untitled",
    pageUrl: tab.url || "",
    capturedAt: new Date().toISOString()
  };
}

function isOrdinaryTab(tab) {
  if (!tab?.url) {
    return false;
  }
  try {
    return new Set(["http:", "https:", "file:"]).has(new URL(tab.url).protocol);
  } catch {
    return false;
  }
}

async function sendAction(message, fallback) {
  try {
    const response = await sendRuntimeMessage(message);
    if (response?.ok === false && canFallbackFromResponse(response) && typeof fallback === "function") {
      return fallback(new Error(response.error));
    }
    return response;
  } catch (error) {
    if (typeof fallback === "function") {
      return fallback(error);
    }
    throw error;
  }
}

async function fallbackOpenShortcuts() {
  await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  return { ok: true };
}

function canFallbackFromResponse(response) {
  return /unsupported runtime message|receiving end|could not establish connection/i.test(response?.error || "");
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

async function runSaveAction(loadingMessage, action) {
  await runAction(loadingMessage, action, { notify: true });
}

function notifySaveResult(message, isError = false) {
  chrome.notifications?.create(
    {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: isError ? "移山保存失败" : "移山",
      message
    },
    () => {
      if (chrome.runtime.lastError) {
        console.warn("Notification failed:", chrome.runtime.lastError.message);
      }
    }
  );
}

async function runAction(loadingMessage, action, options = {}) {
  setStatus(loadingMessage);
  setBusy(true);
  try {
    await action();
    if (options.quietSuccess) {
      setStatus("准备就绪。");
    } else if (options.notify) {
      notifySaveResult(statusEl.textContent || "已保存到 Obsidian。");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, true);
    if (options.notify) {
      notifySaveResult(message, true);
    }
  } finally {
    setBusy(false);
  }
}

function assertOk(response, fallbackMessage) {
  if (!response?.ok) {
    throw new Error(response?.error || fallbackMessage);
  }
}

function normalizeSelectionModifier(value) {
  return ["Alt", "Ctrl", "Shift", "Meta"].includes(value) ? value : DEFAULT_CONFIG.selectionModifier;
}

function setBusy(isBusy) {
  for (const button of allButtons) {
    button.disabled = isBusy;
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}
