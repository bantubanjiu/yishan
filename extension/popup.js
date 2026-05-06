const HOST_NAME = "com.local.obsidian_web_clipper";
const DEFAULT_CONFIG = {
  vaultPath: "",
  inboxDir: "Inbox",
  attachmentsDir: "Inbox\\attachments",
  selectionModifier: "Alt"
};

const fields = {
  vaultPath: document.querySelector("#vaultPath"),
  inboxDir: document.querySelector("#inboxDir"),
  attachmentsDir: document.querySelector("#attachmentsDir"),
  selectionModifier: document.querySelector("#selectionModifier")
};

const controls = {
  saveCurrentTab: document.querySelector("#saveCurrentTab"),
  saveCurrentWindow: document.querySelector("#saveCurrentWindow"),
  captureScreenshot: document.querySelector("#captureScreenshot"),
  chooseVault: document.querySelector("#chooseVault"),
  saveConfig: document.querySelector("#saveConfig"),
  reload: document.querySelector("#reload"),
  openShortcuts: document.querySelector("#openShortcuts")
};

const statusEl = document.querySelector("#status");
const allButtons = Array.from(document.querySelectorAll("button"));

controls.saveCurrentTab.addEventListener("click", () => runAction("正在保存当前页面...", saveCurrentTab));
controls.saveCurrentWindow.addEventListener("click", () => runAction("正在保存当前窗口标签...", saveCurrentWindow));
controls.captureScreenshot.addEventListener("click", () => runAction("请在页面中拖拽选择截图区域...", captureScreenshot));
controls.chooseVault.addEventListener("click", () => runAction("正在打开文件夹选择...", chooseVaultFolder));
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
}

function readConfig() {
  return {
    vaultPath: fields.vaultPath.value.trim(),
    inboxDir: fields.inboxDir.value.trim() || DEFAULT_CONFIG.inboxDir,
    attachmentsDir: fields.attachmentsDir.value.trim() || DEFAULT_CONFIG.attachmentsDir,
    selectionModifier: normalizeSelectionModifier(fields.selectionModifier.value)
  };
}

async function fallbackSaveCurrentTab() {
  const tab = await getActiveTab();
  return sendNativeMessage(buildUrlCapture(tab));
}

async function fallbackSaveCurrentWindow() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const candidates = tabs.filter(isOrdinaryTab);
  const failures = [];
  let saved = 0;

  for (const tab of candidates) {
    try {
      const response = await sendNativeMessage(buildUrlCapture(tab));
      assertOk(response, "保存失败");
      saved += 1;
    } catch (error) {
      failures.push({ tabId: tab.id, title: tab.title || "Untitled", error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    ok: failures.length === 0,
    total: tabs.length,
    attempted: candidates.length,
    saved,
    skipped: tabs.length - candidates.length,
    failed: failures.length,
    failures
  };
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


