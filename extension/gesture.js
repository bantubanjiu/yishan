import { DEFAULT_SETTINGS } from "./constants.js";
import { loadGestureConfig } from "./config-client.js";
import { getActiveTab } from "./utils.js";

export async function syncSelectionGestureForActiveTab() {
  const config = await loadGestureConfig();
  try {
    const tab = await getActiveTab();
    return injectGestureSaver(tab.id, tab, config);
  } catch {
    return false;
  }
}

export async function syncSelectionGestureForTab(tabId, knownTab) {
  const tab = knownTab || await safeGetTab(tabId);
  if (!isGestureScriptableTab(tab)) {
    return false;
  }

  const config = await loadGestureConfig();
  return injectGestureSaver(tabId, tab, config);
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
