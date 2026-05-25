const HOST_NAME = "com.local.obsidian_web_clipper";
const DEFAULT_CONFIG = {
  vaultPath: "",
  selectionModifier: "Alt",
  selectionGestureEnabled: false,
  selectionSaveMode: "plain"
};

const fields = {
  vaultPath: document.querySelector("#vaultPath"),
  selectionModifier: document.querySelector("#selectionModifier"),
  selectionSaveMode: document.querySelector("#selectionSaveMode"),
  selectionGestureEnabled: document.querySelector("#selectionGestureEnabled")
};
const statusEl = document.querySelector("#status");
const shortcutSummary = document.querySelector("#shortcutSummary");
const buttons = Array.from(document.querySelectorAll("button"));
const ENTRANCE_BUTTON_IDS = new Set(["openShortcuts", "reload"]);
const MESSAGE_TIMEOUT_MS = 4_000;
let hiddenConfig = {
  inboxDir: "Inbox",
  attachmentsDir: "Inbox\\attachments"
};

const saveButton = document.querySelector("#save");
const reloadButton = document.querySelector("#reload");
const chooseVaultButton = document.querySelector("#chooseVault");
const openShortcutsButton = document.querySelector("#openShortcuts");

saveButton.addEventListener("click", () => runAction("正在保存...", saveConfig));
reloadButton.addEventListener("click", () => runAction("正在读取设置...", loadConfig));
chooseVaultButton.addEventListener("click", () => runAction("正在打开文件夹选择...", chooseVaultFolder));
openShortcutsButton.addEventListener("click", () => runAction("正在打开快捷键设置...", openShortcuts));

await runAction("正在读取设置...", loadConfig);

async function loadConfig() {
  const response = await sendAction({ type: "get-config" }, () => sendNativeMessage({ type: "get-config" }));
  assertOk(response, "读取失败");
  applyConfig(response.config || {});
  await renderShortcutSummary();
  setStatus("已读取当前设置。");
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

async function renderShortcutSummary() {
  try {
    const commands = await chrome.commands.getAll();
    const saveTabs = findCommandShortcut(commands, "quick-save-current-window");
    const screenshot = findCommandShortcut(commands, "capture-screenshot-area");
    const missing = [saveTabs, screenshot].filter((shortcut) => !shortcut).length;
    shortcutSummary.textContent = missing
      ? `${missing} 个未绑定或被占用，请打开 Chrome 快捷键设置。`
      : `标签 ${saveTabs}；截图 ${screenshot}`;
    shortcutSummary.classList.toggle("warning", missing > 0);
  } catch {
    shortcutSummary.textContent = "无法读取快捷键状态。";
    shortcutSummary.classList.add("warning");
  }
}

function findCommandShortcut(commands, name) {
  const command = commands.find((item) => item.name === name);
  return typeof command?.shortcut === "string" ? command.shortcut : "";
}

function applyConfig(config) {
  fields.vaultPath.value = config.vaultPath || DEFAULT_CONFIG.vaultPath;
  hiddenConfig = {
    inboxDir: config.inboxDir || hiddenConfig.inboxDir,
    attachmentsDir: config.attachmentsDir || hiddenConfig.attachmentsDir
  };
  fields.selectionModifier.value = normalizeSelectionModifier(config.selectionModifier || config.gestureModifier);
  fields.selectionSaveMode.value = config.selectionSaveMode === "rich" ? "rich" : DEFAULT_CONFIG.selectionSaveMode;
  fields.selectionGestureEnabled.checked = config.selectionGestureEnabled === true;
}

function readConfig() {
  return {
    vaultPath: fields.vaultPath.value.trim(),
    inboxDir: hiddenConfig.inboxDir,
    attachmentsDir: hiddenConfig.attachmentsDir,
    selectionModifier: normalizeSelectionModifier(fields.selectionModifier.value),
    selectionSaveMode: fields.selectionSaveMode.value === "rich" ? "rich" : DEFAULT_CONFIG.selectionSaveMode,
    selectionGestureEnabled: fields.selectionGestureEnabled.checked
  };
}

async function sendAction(message, fallback) {
  const timeoutMessage = "请求超时，请检查 Native Host 安装或稍后重试。";
  try {
    const response = await withTimeout(sendRuntimeMessage(message), timeoutMessage);
    if (response?.ok === false && canFallbackFromResponse(response) && typeof fallback === "function") {
      return withTimeout(fallback(new Error(response.error)), timeoutMessage);
    }
    return response;
  } catch (error) {
    if (typeof fallback === "function") {
      return withTimeout(fallback(error), timeoutMessage);
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

function withTimeout(promise, message, timeoutMs = MESSAGE_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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

async function runAction(loadingMessage, action) {
  setStatus(loadingMessage);
  setBusy(true, { allowEntrances: true });
  try {
    await action();
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

function setBusy(isBusy, options = {}) {
  for (const button of buttons) {
    const keepEntranceEnabled = options.allowEntrances && ENTRANCE_BUTTON_IDS.has(button.id);
    button.disabled = isBusy && !keepEntranceEnabled;
    if (isBusy && !keepEntranceEnabled) {
      button.classList.add("is-loading");
    } else {
      button.classList.remove("is-loading");
    }
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = "status-msg"; // Reset
  if (isError) {
    statusEl.classList.add("error");
  }
}
