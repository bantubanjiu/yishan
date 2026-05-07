const HOST_NAME = "com.local.obsidian_web_clipper";
const DEFAULT_CONFIG = {
  vaultPath: "",
  inboxDir: "Inbox",
  attachmentsDir: "Inbox\\attachments",
  selectionModifier: "Alt",
  selectionGestureEnabled: false,
  selectionSaveMode: "plain"
};

const fields = {
  vaultPath: document.querySelector("#vaultPath"),
  inboxDir: document.querySelector("#inboxDir"),
  attachmentsDir: document.querySelector("#attachmentsDir"),
  selectionModifier: document.querySelector("#selectionModifier"),
  selectionSaveMode: document.querySelector("#selectionSaveMode"),
  selectionGestureEnabled: document.querySelector("#selectionGestureEnabled")
};

const controls = {
  saveCurrentTab: document.querySelector("#saveCurrentTab"),
  saveCurrentWindow: document.querySelector("#saveCurrentWindow"),
  captureScreenshot: document.querySelector("#captureScreenshot"),
  captureViewport: document.querySelector("#captureViewport"),
  savePdfLink: document.querySelector("#savePdfLink"),
  chooseVault: document.querySelector("#chooseVault"),
  openTodayInbox: document.querySelector("#openTodayInbox"),
  openAttachments: document.querySelector("#openAttachments"),
  openVaultRoot: document.querySelector("#openVaultRoot"),
  openConfigFile: document.querySelector("#openConfigFile"),
  saveConfig: document.querySelector("#saveConfig"),
  reload: document.querySelector("#reload"),
  openShortcuts: document.querySelector("#openShortcuts")
};

const statusEl = document.querySelector("#status");
const allButtons = Array.from(document.querySelectorAll("button"));

controls.saveCurrentTab.addEventListener("click", () => runAction("正在保存当前页面...", saveCurrentTab));
controls.saveCurrentWindow.addEventListener("click", () => runAction("正在保存当前窗口标签...", saveCurrentWindow));
controls.captureScreenshot.addEventListener("click", () => runAction("请在页面中拖拽选择截图区域...", captureScreenshot));
controls.captureViewport.addEventListener("click", () => runAction("正在保存当前视口截图...", captureViewport));
controls.savePdfLink.addEventListener("click", () => runAction("正在保存 PDF 链接...", savePdfLink));
controls.chooseVault.addEventListener("click", () => runAction("正在打开文件夹选择...", chooseVaultFolder));
controls.openTodayInbox.addEventListener("click", () => runAction("正在打开今天 Inbox...", () => openPathTarget("today-inbox")));
controls.openAttachments.addEventListener("click", () => runAction("正在打开附件目录...", () => openPathTarget("attachments")));
controls.openVaultRoot.addEventListener("click", () => runAction("正在打开 Vault 根目录...", () => openPathTarget("vault")));
controls.openConfigFile.addEventListener("click", () => runAction("正在打开配置文件...", () => openPathTarget("config")));
controls.saveConfig.addEventListener("click", () => runAction("正在保存设置...", saveConfig));
controls.reload.addEventListener("click", () => runAction("正在读取设置...", loadConfig));
controls.openShortcuts.addEventListener("click", () => runAction("正在打开快捷键设置...", openShortcuts));

await runAction("正在读取设置...", loadConfig, { quietSuccess: true });

async function saveCurrentTab() {
  const response = await sendAction({ type: "save-current-tab" }, () => fallbackSaveCurrentTab());
  assertOk(response, "保存失败");
  setStatus("当前页面已保存到 Obsidian。");
}

async function saveCurrentWindow() {
  const response = await sendAction({ type: "save-current-window" }, () => fallbackSaveCurrentWindow());
  assertOk(response, "保存窗口失败");
  if (typeof response.saved === "number" && typeof response.attempted === "number") {
    const failed = Number(response.failed || 0);
    setStatus(failed > 0 ? `已保存 ${response.saved}/${response.attempted} 个标签，失败 ${failed} 个。` : `当前窗口 ${response.saved} 个标签已保存。`, failed > 0);
    return;
  }
  setStatus("当前窗口标签已保存。");
}

async function captureScreenshot() {
  const response = await sendAction({ type: "capture-screenshot" });
  assertOk(response, "截图失败");
  setStatus("截图已保存到 Obsidian。");
}

async function captureViewport() {
  const response = await sendAction({ type: "capture-viewport-screenshot" });
  assertOk(response, "当前视口截图失败");
  setStatus("当前视口截图已保存到 Obsidian。");
}

async function savePdfLink() {
  const response = await sendAction({ type: "save-pdf-link" }, () => fallbackSavePdfLink());
  assertOk(response, "保存 PDF 链接失败");
  setStatus("PDF 链接已保存到 Obsidian。");
}

async function loadConfig() {
  const response = await sendAction({ type: "get-config" }, () => sendNativeMessage({ type: "get-config" }));
  assertOk(response, "读取失败");
  applyConfig(response.config || {});
  setStatus("设置已读取。");
}

async function saveConfig() {
  const config = readConfig();
  if (!config.vaultPath) {
    throw new Error("请填写 Obsidian Vault 路径。");
  }
  const response = await sendAction({ type: "set-config", config }, () => sendNativeMessage({ type: "set-config", config }));
  assertOk(response, "保存失败");
  setStatus("设置已保存。");
}

async function chooseVaultFolder() {
  const response = await sendAction(
    { type: "pick-folder", purpose: "vaultPath", initialPath: fields.vaultPath.value.trim() },
    () => sendNativeMessage({ type: "pick-folder", purpose: "vaultPath", initialPath: fields.vaultPath.value.trim() })
  );
  assertOk(response, "选择文件夹失败");
  const selectedPath = response.path || response.folderPath || response.vaultPath;
  if (!selectedPath) {
    throw new Error("没有返回文件夹路径。");
  }
  fields.vaultPath.value = selectedPath;
  setStatus("已选择 Vault 路径，记得保存设置。");
}

async function openPathTarget(target) {
  const response = await sendAction({ type: "open-path", target }, () => sendNativeMessage({ type: "open-path", target }));
  assertOk(response, "打开路径失败");
  setStatus("已请求系统打开路径。");
}

async function openShortcuts() {
  const response = await sendAction({ type: "open-shortcuts" }, fallbackOpenShortcuts);
  assertOk(response, "打开快捷键设置失败");
  setStatus("已打开 Chrome 快捷键设置。");
}

function applyConfig(config) {
  fields.vaultPath.value = config.vaultPath || DEFAULT_CONFIG.vaultPath;
  fields.inboxDir.value = config.inboxDir || DEFAULT_CONFIG.inboxDir;
  fields.attachmentsDir.value = config.attachmentsDir || DEFAULT_CONFIG.attachmentsDir;
  fields.selectionModifier.value = normalizeSelectionModifier(config.selectionModifier || config.gestureModifier);
  fields.selectionSaveMode.value = config.selectionSaveMode === "rich" ? "rich" : DEFAULT_CONFIG.selectionSaveMode;
  fields.selectionGestureEnabled.checked = config.selectionGestureEnabled === true;
}

function readConfig() {
  return {
    vaultPath: fields.vaultPath.value.trim(),
    inboxDir: fields.inboxDir.value.trim() || DEFAULT_CONFIG.inboxDir,
    attachmentsDir: fields.attachmentsDir.value.trim() || DEFAULT_CONFIG.attachmentsDir,
    selectionModifier: normalizeSelectionModifier(fields.selectionModifier.value),
    selectionSaveMode: fields.selectionSaveMode.value === "rich" ? "rich" : DEFAULT_CONFIG.selectionSaveMode,
    selectionGestureEnabled: fields.selectionGestureEnabled.checked
  };
}

async function fallbackSaveCurrentTab() {
  const tab = await getActiveTab();
  return sendNativeMessage(buildUrlCapture(tab));
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

async function fallbackSavePdfLink() {
  const tab = await getActiveTab();
  if (!isPdfTab(tab)) {
    return { ok: false, error: "当前标签页不是 PDF 链接" };
  }
  return sendNativeMessage(buildUrlCapture(tab));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    throw new Error("没有找到当前活动标签页。");
  }
  return tab;
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

function isPdfTab(tab) {
  if (!tab?.url) {
    return false;
  }
  try {
    const url = new URL(tab.url);
    return ["http:", "https:", "file:"].includes(url.protocol) && url.pathname.toLowerCase().endsWith(".pdf");
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

async function runAction(loadingMessage, action, options = {}) {
  setStatus(loadingMessage);
  setBusy(true);
  try {
    await action();
    if (options.quietSuccess) {
      setStatus("准备就绪。");
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
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
