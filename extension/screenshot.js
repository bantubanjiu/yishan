import { normalizeSelectionRect } from "./screenshot-crop.js";

export async function buildScreenshotCapture(tab, mode = "selection") {
  const imageUrl = mode === "viewport" ? await captureViewport(tab) : await captureSelectedArea(tab);
  return {
    type: "image",
    title: tab?.title || "Untitled",
    pageUrl: tab?.url || "",
    capturedAt: new Date().toISOString(),
    imageUrl
  };
}

export async function captureAndSaveScreenshot(tab, saveCapture, mode = "selection") {
  return saveCapture(await buildScreenshotCapture(tab, mode));
}

async function captureVisibleTab(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}

async function captureViewport(tab) {
  if (!tab?.id) {
    throw new Error("No active tab for screenshot capture");
  }
  await waitForPageRepaint(tab.id);
  return captureVisibleTab(tab.windowId);
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
    let activePointerId = null;
    let finished = false;

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
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      overlay.removeEventListener("pointerdown", onPointerDown, true);
      overlay.removeEventListener("pointermove", onPointerMove, true);
      if (activePointerId !== null && overlay.hasPointerCapture?.(activePointerId)) {
        overlay.releasePointerCapture(activePointerId);
      }
      overlay.remove();
    };

    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
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
        if (finished) {
          return;
        }
        finished = true;
        cleanup();
        reject(new Error("已取消截图"));
      }
    }

    function onPointerDown(event) {
      event.preventDefault();
      start = { x: event.clientX, y: event.clientY };
      current = start;
      activePointerId = event.pointerId;
      overlay.setPointerCapture(activePointerId);
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

    function onMouseUp(event) {
      if (!start) {
        return;
      }
      event.preventDefault();
      current = { x: event.clientX, y: event.clientY };
      finish();
    }

    function onPointerCancel(event) {
      if (!start) {
        return;
      }
      event.preventDefault();
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
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    overlay.addEventListener("pointerdown", onPointerDown, true);
    overlay.addEventListener("pointermove", onPointerMove, true);
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
