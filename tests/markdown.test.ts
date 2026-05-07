import assert from "node:assert/strict";
import test from "node:test";

import { formatCaptureEntry } from "../src/host/markdown.ts";

function localIso(year: number, month: number, day: number, hour: number, minute: number, second = 0): string {
  return new Date(year, month - 1, day, hour, minute, second).toISOString();
}

function localTime(isoDate: string): string {
  const date = new Date(isoDate);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

test("formats a captured URL as one timestamped markdown list item", () => {
  const entry = formatCaptureEntry({
    type: "url",
    title: "Example [Docs]",
    pageUrl: "https://example.com/docs",
    capturedAt: localIso(2026, 4, 29, 6, 30)
  });

  assert.equal(entry, "- 06:30 [Example \\[Docs\\]](https://example.com/docs)\n");
});

test("formats capture time in the host local timezone", () => {
  const capturedAt = new Date(Date.UTC(2026, 3, 29, 6, 30)).toISOString();

  const entry = formatCaptureEntry({
    type: "url",
    title: "Local Time",
    pageUrl: "https://example.com/local-time",
    capturedAt
  });

  assert.equal(entry, `- ${localTime(capturedAt)} [Local Time](https://example.com/local-time)\n`);
});

test("formats selected text as an Obsidian fenced code block under the source link", () => {
  const entry = formatCaptureEntry({
    type: "selection",
    title: "Article",
    pageUrl: "https://example.com/a",
    text: "first line\n  second line",
    markdown: "## Heading\n\n**first line**\n\nsecond line",
    capturedAt: localIso(2026, 4, 29, 6, 31)
  });

  assert.equal(
    entry,
    "- 06:31 [Article](https://example.com/a)\n\n```text\nfirst line\n  second line\n```\n"
  );
});

test("uses a longer code fence when selected text already contains backtick fences", () => {
  const entry = formatCaptureEntry({
    type: "selection",
    title: "Article",
    pageUrl: "https://example.com/a",
    text: "before\n```\ninside\n```\nafter",
    capturedAt: localIso(2026, 4, 29, 6, 31)
  });

  assert.equal(entry, "- 06:31 [Article](https://example.com/a)\n\n````text\nbefore\n```\ninside\n```\nafter\n````\n");
});

test("uses explicit selection code language when provided by the browser context", () => {
  const entry = formatCaptureEntry({
    type: "selection",
    title: "Code",
    pageUrl: "https://example.com/code",
    text: "const value = 1;",
    codeLanguage: "javascript",
    capturedAt: localIso(2026, 4, 29, 6, 31)
  });

  assert.equal(entry, "- 06:31 [Code](https://example.com/code)\n\n```js\nconst value = 1;\n```\n");
});

test("detects JSON selections and labels the code block", () => {
  const entry = formatCaptureEntry({
    type: "selection",
    title: "JSON",
    pageUrl: "https://example.com/json",
    text: '{\n  "name": "yishan",\n  "enabled": true\n}',
    capturedAt: localIso(2026, 4, 29, 6, 31)
  });

  assert.equal(entry, "- 06:31 [JSON](https://example.com/json)\n\n```json\n{\n  \"name\": \"yishan\",\n  \"enabled\": true\n}\n```\n");
});

test("detects common code-like selections before falling back to text", () => {
  const htmlEntry = formatCaptureEntry({
    type: "selection",
    title: "HTML",
    pageUrl: "https://example.com/html",
    text: '<section class="hero">\n  <h1>移山</h1>\n</section>',
    capturedAt: localIso(2026, 4, 29, 6, 31)
  });
  const pythonEntry = formatCaptureEntry({
    type: "selection",
    title: "Python",
    pageUrl: "https://example.com/python",
    text: "def clip(text):\n    return text.strip()",
    capturedAt: localIso(2026, 4, 29, 6, 32)
  });
  const textEntry = formatCaptureEntry({
    type: "selection",
    title: "Note",
    pageUrl: "https://example.com/note",
    text: "这是一段普通摘录，不应该被误判为代码。",
    capturedAt: localIso(2026, 4, 29, 6, 33)
  });

  assert.match(htmlEntry, /\n```html\n/);
  assert.match(pythonEntry, /\n```python\n/);
  assert.match(textEntry, /\n```text\n/);
});

test("formats a downloaded image as an embedded Obsidian attachment with original image URL", () => {
  const entry = formatCaptureEntry(
    {
      type: "image",
      title: "Image Page",
      pageUrl: "https://example.com/page",
      imageUrl: "https://cdn.example.com/image.jpg",
      capturedAt: localIso(2026, 4, 29, 6, 32)
    },
    { attachmentName: "20260429-063200-image.jpg" }
  );

  assert.equal(
    entry,
    "- 06:32 [Image Page](https://example.com/page)\n  ![[20260429-063200-image.jpg]]\n  来源图片：https://cdn.example.com/image.jpg\n"
  );
});

test("formats image download failure without dropping the source image URL", () => {
  const entry = formatCaptureEntry(
    {
      type: "image",
      title: "Image Page",
      pageUrl: "https://example.com/page",
      imageUrl: "https://cdn.example.com/image.jpg",
      capturedAt: localIso(2026, 4, 29, 6, 33)
    },
    { imageError: "HTTP 403" }
  );

  assert.equal(
    entry,
    "- 06:33 [Image Page](https://example.com/page)\n  图片下载失败：HTTP 403\n  来源图片：https://cdn.example.com/image.jpg\n"
  );
});
