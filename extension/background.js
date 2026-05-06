import { normalizeSelectionRect } from "./screenshot-crop.js";

const HOST_NAME = "com.local.obsidian_web_clipper";

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
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const capture = await buildCaptureMessage(info, tab);
    const response = await sendNativeMessage(capture);
    if (!response?.ok) {
      throw new Error(response?.error || "Unknown native host error");
    }
    notify("已保存到 Obsidian");
  } catch (error) {
    notify(`保存失败：${error instanceof Error ? error.message : String(error)}`);
  }
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
      markdown: selection.markdown || text
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
    const imageUrl = await captureSelectedArea(tab);
    return {
      type: "image",
      ...base,
      imageUrl
    };
  }

  throw new Error(`Unsupported menu item: ${info.menuItemId}`);
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
    return { text: editableSelection, markdown: editableSelection };
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
    markdown: chooseSelectionMarkdown(selection.toString(), nodesToMarkdown(Array.from(container.childNodes)).trim())
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
