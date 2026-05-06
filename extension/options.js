const HOST_NAME = "com.local.obsidian_web_clipper";

const fields = {
  vaultPath: document.querySelector("#vaultPath"),
  inboxDir: document.querySelector("#inboxDir"),
  attachmentsDir: document.querySelector("#attachmentsDir")
};
const statusEl = document.querySelector("#status");

document.querySelector("#save").addEventListener("click", saveConfig);
document.querySelector("#reload").addEventListener("click", loadConfig);

await loadConfig();

async function loadConfig() {
  setStatus("正在读取设置...");
  try {
    const response = await sendNativeMessage({ type: "get-config" });
    if (!response?.ok) {
      throw new Error(response?.error || "读取失败");
    }
    fields.vaultPath.value = response.config.vaultPath || "";
    fields.inboxDir.value = response.config.inboxDir || "Inbox";
    fields.attachmentsDir.value = response.config.attachmentsDir || "Inbox\\attachments";
    setStatus("已读取当前设置。");
  } catch (error) {
    setStatus(`读取失败：${error instanceof Error ? error.message : String(error)}`, true);
  }
}

async function saveConfig() {
  const config = {
    vaultPath: fields.vaultPath.value.trim(),
    inboxDir: fields.inboxDir.value.trim() || "Inbox",
    attachmentsDir: fields.attachmentsDir.value.trim() || "Inbox\\attachments"
  };

  if (!config.vaultPath) {
    setStatus("请填写 Obsidian Vault 路径。", true);
    return;
  }

  setStatus("正在保存...");
  try {
    const response = await sendNativeMessage({ type: "set-config", config });
    if (!response?.ok) {
      throw new Error(response?.error || "保存失败");
    }
    setStatus("设置已保存。");
  } catch (error) {
    setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`, true);
  }
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

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}
