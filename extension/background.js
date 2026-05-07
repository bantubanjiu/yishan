import { normalizeSelectionRect } from "./screenshot-crop.js";

const HOST_NAME = "com.local.obsidian_web_clipper";
const DEFAULT_SETTINGS = {
  inboxDir: "Inbox",
  attachmentsDir: "Inbox\\attachments",
  selectionModifier: "Alt",
  selectionGestureEnabled: false,
  gestureLongPressMs: 250
};
const ORDINARY_TAB_PROTOCOLS = new Set(["http:", "https:", "file:"]);

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-url",
    title: "保存当前页面到 Obsidian",
    contexts: ["page"]
  });
  chrome.contextMenus.create({
    id: "save-selection",
    title: "保存选中文本到 Obsidian",
    contexts: ["selection", "editable"]
  });
  chrome.contextMenus.create({
    id: "save-image",
    title: "保存图片到 Obsidian",
    contexts: ["image"]
  });
  chrome.contextMenus.create({
    id: "save-screenshot",
    title: "框选截图保存到 Obsidian",
    contexts: ["page", "selection", "image", "editable"]
  });

  void syncSelectionGestureForActiveTab();
});

chrome.runtime.onStartup?.addListener(() => {
  void syncSelectionGestureForActiveTab();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const capture = await buildCaptureMessage(info, tab);
    await saveCapture(capture);
    notify("已保存到 Obsidian");
  } catch (error) {
    notify(`保存失败：${error instanceof Error ? error.message : String(error)}`);
  }
});

chrome.commands?.onCommand.addListener(async (command) => {
  try {
    if (command === "capture-screenshot-area") {
      const tab = await getActiveTab();
      await captureAndSaveScreenshot(tab);
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleRuntimeMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  return true;
});

async function buildCaptureMessage(info, tab) {
  const base = {
    title: tab?.title || "Untitled",
    pageUrl: info.pageUrl || tab?.url || "",
    capturedAt: new Date().toISOString()
  };

  if (info.menuItemId === "save-url") {
    return {
      type: "url",
      ...base
    };
  }

  if (info.menuItemId === "save-selection") {
    const selection = await getSelectionAsMarkdown(tab?.id, info.selectionText || "");
    const text = selection.text || info.selectionText || "";
    if (!text.trim()) {
      throw new Error("没有检测到选中文本");
    }
    return {
      type: "selection",
      ...base,
      text,
      markdown: selection.markdown || text,
      codeLanguage: selection.codeLanguage || undefined
    };
  }

  if (info.menuItemId === "save-image") {
    return {
      type: "image",
      ...base,
      imageUrl: info.srcUrl || ""
    };
  }

  if (info.menuItemId === "save-screenshot") {
    return buildScreenshotCapture(tab);
  }

  throw new Error(`Unsupported menu item: ${info.menuItemId}`);
}

async function handleRuntimeMessage(message, sender) {
  if (!isRecord(message) || typeof message.type !== "string") {
    return { ok: false, error: "Runtime message must include a type" };
  }

  if (message.type === "get-default-settings") {
    return {
      ok: true,
      settings: { ...DEFAULT_SETTINGS }
    };
  }

  if (message.type === "get-config") {
    return normalizeConfigResponse(await sendNativeMessage({ type: "get-config" }));
  }

  if (message.type === "set-config") {
    const response = await sendNativeMessage({ type: "set-config", config: normalizeConfig(message.config || {}) });
    await syncSelectionGestureForActiveTab();
    return response;
  }

  if (message.type === "pick-folder") {
    const request = { ...message, type: "pick-folder" };
    return sendNativeMessage(request);
  }

  if (message.type === "save-current-tab") {
    const tab = await getActiveTab();
    if (!isOrdinaryTab(tab)) {
      return { ok: false, error: "当前标签页不是可保存的普通页面" };
    }
    const response = await saveCapture(buildUrlCapture(tab));
    return { ok: true, response };
  }

  if (message.type === "save-current-window") {
    return saveCurrentWindowTabs();
  }

  if (message.type === "capture-screenshot") {
    const tab = await getActiveTab();
    const response = await captureAndSaveScreenshot(tab);
    return { ok: true, response };
  }

  if (message.type === "open-shortcuts") {
    await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    return { ok: true };
  }

  if (message.type === "save-selection-from-gesture") {
    const tab = sender.tab || {};
    const text = typeof message.text === "string" ? message.text : "";
    const selection = await getSelectionAsMarkdown(sender.tab?.id, text);
    const markdown = typeof message.markdown === "string" ? message.markdown : selection.markdown || text;
    if (!text.trim() && !markdown.trim()) {
      return { ok: false, error: "没有检测到选中文本" };
    }
    const response = await saveCapture({
      type: "selection",
      title: tab?.title || "Untitled",
      pageUrl: tab?.url || message.pageUrl || "",
      text,
      markdown,
      codeLanguage: typeof message.codeLanguage === "string" ? message.codeLanguage || undefined : selection.codeLanguage || undefined,
      capturedAt: new Date().toISOString()
    });
    notify("已保存选中文本到 Obsidian");
    return { ok: true, response };
  }

  return { ok: false, error: `Unsupported runtime message: ${message.type}` };
}

async function saveCapture(capture) {
  const response = await sendNativeMessage(capture);
  if (!response?.ok) {
    throw new Error(response?.error || "Unknown native host error");
  }
  return response;
}

function buildUrlCapture(tab) {
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

async function buildScreenshotCapture(tab) {
  const imageUrl = await captureSelectedArea(tab);
  return {
    type: "image",
    title: tab?.title || "Untitled",
    pageUrl: tab?.url || "",
    capturedAt: new Date().toISOString(),
    imageUrl
  };
}

async function captureAndSaveScreenshot(tab) {
  return saveCapture(await buildScreenshotCapture(tab));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("没有找到当前活动标签页");
  }
  return tab;
}

async function saveCurrentWindowTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const candidates = tabs.filter(isOrdinaryTab);
  const failures = [];
  let saved = 0;

  for (const tab of candidates) {
    try {
      await saveCapture(buildUrlCapture(tab));
      saved += 1;
    } catch (error) {
      failures.push({
        tabId: tab.id,
        title: tab.title || "Untitled",
        url: tab.url || "",
        error: error instanceof Error ? error.message : String(error)
      });
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

function formatBatchSaveNotification(result) {
  if (result.attempted === 0) {
    return "当前窗口没有可保存的普通标签页";
  }
  if (result.failed > 0) {
    return `已保存 ${result.saved}/${result.attempted} 个标签页，失败 ${result.failed} 个`;
  }
  return `已保存当前窗口 ${result.saved} 个标签页到 Obsidian`;
}

function isOrdinaryTab(tab) {
  if (!tab?.url) {
    return false;
  }
  try {
    return ORDINARY_TAB_PROTOCOLS.has(new URL(tab.url).protocol);
  } catch {
    return false;
  }
}

async function syncSelectionGestureForActiveTab() {
  const config = await loadGestureConfig();
  try {
    const tab = await getActiveTab();
    return injectGestureSaver(tab.id, tab, config);
  } catch {
    return false;
  }
}

async function injectGestureSaver(tabId, tab, config) {
  if (!tabId || (tab && !isGestureScriptableTab(tab))) {
    return false;
  }

  try {
    const gestureConfig = config || await loadGestureConfig();
    if (!gestureConfig.selectionGestureEnabled) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: uninstallAltDragSelectionSaver
      });
      return false;
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      func: installAltDragSelectionSaver,
      args: [{
        modifier: gestureConfig.selectionModifier,
        longPressMs: DEFAULT_SETTINGS.gestureLongPressMs
      }]
    });
    return true;
  } catch {
    return false;
  }
}

async function loadGestureConfig() {
  try {
    const response = await sendNativeMessage({ type: "get-config" });
    return normalizeConfig(response?.config || {});
  } catch {
    return normalizeConfig({});
  }
}

function normalizeConfigResponse(response) {
  if (!response?.ok) {
    return response;
  }
  return {
    ...response,
    config: normalizeConfig(response.config || {})
  };
}

function normalizeConfig(config) {
  return {
    ...config,
    inboxDir: config.inboxDir || DEFAULT_SETTINGS.inboxDir,
    attachmentsDir: config.attachmentsDir || DEFAULT_SETTINGS.attachmentsDir,
    selectionModifier: normalizeSelectionModifier(config.selectionModifier || config.gestureModifier),
    selectionGestureEnabled: config.selectionGestureEnabled === true
  };
}

function normalizeSelectionModifier(value) {
  return ["Alt", "Ctrl", "Shift", "Meta"].includes(value) ? value : DEFAULT_SETTINGS.selectionModifier;
}

async function safeGetTab(tabId) {
  if (!tabId) {
    return null;
  }

  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

function isGestureScriptableTab(tab) {
  if (!tab?.url) {
    return false;
  }
  try {
    const protocol = new URL(tab.url).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "file:";
  } catch {
    return false;
  }
}

async function getSelectionAsMarkdown(tabId, fallbackText = "") {
  if (!tabId) {
    return { text: fallbackText, markdown: fallbackText };
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: selectionToMarkdown,
      args: [fallbackText]
    });

    return result?.result || { text: fallbackText, markdown: fallbackText };
  } catch (error) {
    return { text: fallbackText, markdown: fallbackText };
  }
}

function selectionToMarkdown(fallbackText = "") {
  const editableSelection = getEditableSelectionText();
  if (editableSelection) {
    return { text: editableSelection, markdown: editableSelection, codeLanguage: detectCodeLanguageFromPageContext(document.activeElement) };
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { text: fallbackText, markdown: fallbackText };
  }

  const container = document.createElement("div");
  for (let index = 0; index < selection.rangeCount; index += 1) {
    container.appendChild(selection.getRangeAt(index).cloneContents());
  }

  return {
    text: selection.toString(),
    markdown: chooseSelectionMarkdown(selection.toString(), nodesToMarkdown(Array.from(container.childNodes)).trim()),
    codeLanguage: detectCodeLanguageFromSelection(selection, container)
  };

  function chooseSelectionMarkdown(plainText, domMarkdown) {
    const normalizedPlain = normalizePlainSelectionText(plainText);
    if (!domMarkdown) {
      return normalizedPlain;
    }

    const plainLineCount = normalizedPlain.split("\n").filter((line) => line.trim()).length;
    const markdownLineCount = domMarkdown.split("\n").filter((line) => line.trim()).length;
    const plainHasStructure = /\n\s*(?:[-*+]\s+|\d+\.\s+|#{1,6}\s+|>|```)/.test(normalizedPlain);

    if (plainLineCount > markdownLineCount + 2 || plainHasStructure) {
      return normalizedPlain;
    }

    return domMarkdown;
  }

  function normalizePlainSelectionText(text) {
    return text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function getEditableSelectionText() {
    const active = document.activeElement;
    if (!active) {
      return "";
    }

    const tag = active.tagName?.toLowerCase();
    if ((tag === "textarea" || tag === "input") && typeof active.selectionStart === "number" && typeof active.selectionEnd === "number") {
      return active.value.slice(active.selectionStart, active.selectionEnd);
    }

    if (active.isContentEditable) {
      return window.getSelection()?.toString() || "";
    }

    return "";
  }

  function detectCodeLanguageFromSelection(selection, container) {
    const explicitCodeNode = findLanguageNode(container);
    if (explicitCodeNode) {
      return explicitCodeNode;
    }

    const anchorLanguage = detectCodeLanguageFromPageContext(selection.anchorNode);
    if (anchorLanguage) {
      return anchorLanguage;
    }

    return detectCodeLanguageFromPageContext(selection.focusNode);
  }

  function detectCodeLanguageFromPageContext(node) {
    let current = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (current && current !== document.documentElement) {
      const language = languageFromElement(current);
      if (language) {
        return language;
      }
      current = current.parentElement;
    }
    return "";
  }

  function findLanguageNode(root) {
    if (root.nodeType === Node.ELEMENT_NODE) {
      const rootLanguage = languageFromElement(root);
      if (rootLanguage) {
        return rootLanguage;
      }
    }

    const node = root.querySelector?.("[class*='language-'], [class*='lang-'], [data-language], [data-lang], pre, code");
    return node ? languageFromElement(node) : "";
  }

  function languageFromElement(element) {
    const tag = element.tagName?.toLowerCase();
    const direct = [
      element.getAttribute("data-language"),
      element.getAttribute("data-lang")
    ].find(Boolean);
    if (direct) {
      return normalizeLanguageName(direct);
    }

    const classLanguage = Array.from(element.classList || [])
      .map((className) => /(?:^|[-_])(language|lang)[-_]([a-z0-9_+#.-]+)/i.exec(className)?.[2])
      .find(Boolean);
    if (classLanguage) {
      return normalizeLanguageName(classLanguage);
    }

    if (tag === "pre") {
      const nestedCode = element.querySelector?.("code");
      if (nestedCode && nestedCode !== element) {
        return languageFromElement(nestedCode);
      }
    }

    return "";
  }

  function normalizeLanguageName(value) {
    return String(value || "").trim().toLowerCase().replace(/^language-/, "").replace(/^lang-/, "");
  }

  function nodesToMarkdown(nodes) {
    return nodes.map(nodeToMarkdown).join("").replace(/\n{3,}/g, "\n\n");
  }

  function nodeToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/\s+/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = node.tagName.toLowerCase();
    const content = nodesToMarkdown(Array.from(node.childNodes)).trim();

    if (!content && tag !== "img") {
      return "";
    }

    if (/^h[1-6]$/.test(tag)) {
      return `\n${"#".repeat(Number(tag.slice(1)))} ${content}\n\n`;
    }
    if (tag === "p" || tag === "div" || tag === "section" || tag === "article") {
      return `\n${content}\n\n`;
    }
    if (tag === "br") {
      return "\n";
    }
    if (tag === "strong" || tag === "b") {
      return `**${content}**`;
    }
    if (tag === "em" || tag === "i") {
      return `*${content}*`;
    }
    if (tag === "code") {
      return `\`${content.replaceAll("`", "\\`")}\``;
    }
    if (tag === "pre") {
      return `\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
    }
    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      return href ? `[${content}](${href})` : content;
    }
    if (tag === "img") {
      const alt = node.getAttribute("alt") || "";
      const src = node.getAttribute("src") || "";
      return src ? `![${alt}](${src})` : "";
    }
    if (tag === "ul") {
      return `\n${Array.from(node.children).map((child) => `- ${nodesToMarkdown(Array.from(child.childNodes)).trim()}`).join("\n")}\n\n`;
    }
    if (tag === "ol") {
      return `\n${Array.from(node.children).map((child, index) => `${index + 1}. ${nodesToMarkdown(Array.from(child.childNodes)).trim()}`).join("\n")}\n\n`;
    }
    if (tag === "blockquote") {
      return `\n${content.split(/\r?\n/).map((line) => `> ${line}`).join("\n")}\n\n`;
    }

    return content;
  }
}

async function captureVisibleTab(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}

async function captureSelectedArea(tab) {
  if (!tab?.id) {
    throw new Error("No active tab for screenshot selection");
  }

  const [selectionResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: selectScreenshotArea
  });
  const selection = selectionResult?.result;
  if (!selection) {
    throw new Error("未选择截图区域");
  }

  const rect = normalizeSelectionRect(selection.start, selection.end, selection.viewport, selection.devicePixelRatio).bitmap;
  if (rect.width < 4 || rect.height < 4) {
    throw new Error("截图区域太小");
  }

  await waitForPageRepaint(tab.id);
  const fullScreenshot = await captureVisibleTab(tab.windowId);
  const [cropResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: cropScreenshotDataUrl,
    args: [fullScreenshot, rect]
  });

  if (!cropResult?.result) {
    throw new Error("截图裁剪失败");
  }

  return cropResult.result;
}

function selectScreenshotArea() {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    const box = document.createElement("div");
    const label = document.createElement("div");
    let start = null;
    let current = null;

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      cursor: "crosshair",
      background: "transparent",
      userSelect: "none"
    });
    Object.assign(box.style, {
      position: "fixed",
      border: "2px solid rgba(255, 255, 255, 0.96)",
      outline: "1px solid rgba(0, 0, 0, 0.55)",
      boxShadow: "0 0 0 99999px rgba(0, 0, 0, 0.35)",
      background: "transparent",
      display: "none",
      pointerEvents: "none"
    });
    Object.assign(label.style, {
      position: "fixed",
      top: "16px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "8px 12px",
      borderRadius: "8px",
      color: "#fff",
      background: "rgba(17, 24, 39, 0.88)",
      font: "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      pointerEvents: "none"
    });
    label.textContent = "拖拽选择截图区域，按 Esc 取消";

    overlay.append(box, label);
    document.documentElement.appendChild(overlay);

    const cleanup = () => {
      window.removeEventListener("keydown", onKeyDown, true);
      overlay.removeEventListener("pointerdown", onPointerDown, true);
      overlay.removeEventListener("pointermove", onPointerMove, true);
      overlay.removeEventListener("pointerup", onPointerUp, true);
      overlay.remove();
    };

    const finish = () => {
      cleanup();
      if (!start || !current) {
        reject(new Error("未选择截图区域"));
        return;
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve({
            start,
            end: current,
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight
            },
            devicePixelRatio: window.devicePixelRatio || 1
          });
        });
      });
    };

    function onKeyDown(event) {
      if (event.key === "Escape") {
        cleanup();
        reject(new Error("已取消截图"));
      }
    }

    function onPointerDown(event) {
      event.preventDefault();
      start = { x: event.clientX, y: event.clientY };
      current = start;
      overlay.setPointerCapture(event.pointerId);
      drawBox();
    }

    function onPointerMove(event) {
      if (!start) {
        return;
      }
      event.preventDefault();
      current = { x: event.clientX, y: event.clientY };
      drawBox();
    }

    function onPointerUp(event) {
      if (!start) {
        return;
      }
      event.preventDefault();
      current = { x: event.clientX, y: event.clientY };
      finish();
    }

    function drawBox() {
      const left = Math.min(start.x, current.x);
      const top = Math.min(start.y, current.y);
      const width = Math.abs(current.x - start.x);
      const height = Math.abs(current.y - start.y);
      Object.assign(box.style, {
        display: "block",
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`
      });
    }

    window.addEventListener("keydown", onKeyDown, true);
    overlay.addEventListener("pointerdown", onPointerDown, true);
    overlay.addEventListener("pointermove", onPointerMove, true);
    overlay.addEventListener("pointerup", onPointerUp, true);
  });
}

function cropScreenshotDataUrl(dataUrl, rect) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = rect.width;
      canvas.height = rect.height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas context unavailable"));
        return;
      }
      context.imageSmoothingEnabled = false;
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Screenshot image load failed"));
    image.src = dataUrl;
  });
}

async function waitForPageRepaint(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      })
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function installAltDragSelectionSaver(options = {}) {
  const stateKey = "__obsidianWebClipperAltDragSelectionSaver";
  const previous = window[stateKey];
  if (previous?.cleanup) {
    previous.cleanup();
  }

  const modifier = options.modifier || "Alt";
  const longPressMs = Number(options.longPressMs) > 0 ? Number(options.longPressMs) : 250;
  const dragThreshold = 6;
  const state = {
    modifierDown: false,
    armed: false,
    dragging: false,
    cancelled: false,
    start: null,
    timer: 0,
    overlay: null,
    box: null
  };

  function isModifierEvent(event) {
    if (modifier === "Alt") {
      return event.key === "Alt" || event.altKey;
    }
    if (modifier === "Shift") {
      return event.key === "Shift" || event.shiftKey;
    }
    if (modifier === "Control" || modifier === "Ctrl") {
      return event.key === "Control" || event.ctrlKey;
    }
    if (modifier === "Meta") {
      return event.key === "Meta" || event.metaKey;
    }
    return event.key === modifier;
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      cancelGesture();
      return;
    }
    if (event.repeat || !isModifierEvent(event) || state.modifierDown) {
      return;
    }

    state.modifierDown = true;
    state.cancelled = false;
    state.timer = window.setTimeout(() => {
      if (state.modifierDown && !state.cancelled) {
        state.armed = true;
      }
    }, longPressMs);
  }

  function onKeyUp(event) {
    if (!isModifierEvent(event)) {
      return;
    }
    state.modifierDown = false;
    if (!state.dragging) {
      cancelGesture();
    }
  }

  function onMouseDown(event) {
    if (!state.armed || event.button !== 0 || isEditableTarget(event.target)) {
      return;
    }
    state.start = { x: event.clientX, y: event.clientY };
    state.dragging = false;
  }

  function onMouseMove(event) {
    if (!state.armed || !state.start || isEditableTarget(event.target)) {
      return;
    }

    const distance = Math.hypot(event.clientX - state.start.x, event.clientY - state.start.y);
    if (distance < dragThreshold && !state.dragging) {
      return;
    }

    state.dragging = true;
    ensureOverlay();
    drawBox(state.start, { x: event.clientX, y: event.clientY });
  }

  function onMouseUp() {
    if (!state.armed || !state.start) {
      return;
    }

    const shouldSave = state.dragging;
    const selection = window.getSelection();
    const text = selection?.toString() || "";
    window.clearTimeout(state.timer);
    state.overlay?.remove();
    state.overlay = null;
    state.box = null;

    if (!shouldSave || !text.trim()) {
      resetGestureState();
      return;
    }

    chrome.runtime.sendMessage({
      type: "save-selection-from-gesture",
      text,
      pageUrl: location.href
    }, () => {
      void chrome.runtime.lastError;
    });
    resetGestureState();
  }

  function ensureOverlay() {
    if (state.overlay && state.box) {
      return;
    }

    const overlay = document.createElement("div");
    const box = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      pointerEvents: "none",
      background: "transparent"
    });
    Object.assign(box.style, {
      position: "fixed",
      display: "none",
      border: "1px solid rgba(37, 99, 235, 0.95)",
      background: "rgba(59, 130, 246, 0.13)",
      boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.7) inset",
      borderRadius: "2px"
    });
    overlay.appendChild(box);
    document.documentElement.appendChild(overlay);
    state.overlay = overlay;
    state.box = box;
  }

  function drawBox(start, end) {
    if (!state.box) {
      return;
    }

    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    Object.assign(state.box.style, {
      display: "block",
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`
    });
  }

  function cancelGesture() {
    window.clearTimeout(state.timer);
    resetGestureState();
    state.cancelled = true;
    state.overlay?.remove();
    state.overlay = null;
    state.box = null;
  }

  function resetGestureState() {
    state.modifierDown = false;
    state.armed = false;
    state.dragging = false;
    state.start = null;
  }

  function cleanup() {
    cancelGesture();
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("mousedown", onMouseDown, true);
    window.removeEventListener("mousemove", onMouseMove, true);
    window.removeEventListener("mouseup", onMouseUp, true);
  }

  function isEditableTarget(target) {
    const element = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    if (!element) {
      return false;
    }
    const editable = element.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']");
    if (!editable) {
      return false;
    }
    if (editable.matches?.("[contenteditable='false']")) {
      return false;
    }
    return true;
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("mouseup", onMouseUp, true);
  window[stateKey] = { cleanup };
}

function uninstallAltDragSelectionSaver() {
  const stateKey = "__obsidianWebClipperAltDragSelectionSaver";
  const previous = window[stateKey];
  if (previous?.cleanup) {
    previous.cleanup();
  }
  delete window[stateKey];
}

function notify(message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "移山",
    message
  }, () => {
    if (chrome.runtime.lastError) {
      console.warn("Notification failed:", chrome.runtime.lastError.message);
    }
  });
}
