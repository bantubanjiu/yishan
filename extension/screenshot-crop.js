export function normalizeSelectionRect(start, end, viewport, devicePixelRatio = 1) {
  const left = Math.max(0, Math.min(start.x, end.x));
  const top = Math.max(0, Math.min(start.y, end.y));
  const right = Math.min(viewport.width, Math.max(start.x, end.x));
  const bottom = Math.min(viewport.height, Math.max(start.y, end.y));
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);

  return {
    css: { x: left, y: top, width, height },
    bitmap: {
      x: Math.round(left * devicePixelRatio),
      y: Math.round(top * devicePixelRatio),
      width: Math.round(width * devicePixelRatio),
      height: Math.round(height * devicePixelRatio)
    }
  };
}
