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

test("formats a captured URL under a level-four page heading with a bullet record", () => {
  const entry = formatCaptureEntry({
    type: "url",
    title: "Example [Docs]",
    pageUrl: "https://example.com/docs",
    capturedAt: localIso(2026, 4, 29, 6, 30)
  });

  assert.equal(entry, "#### [Example \\[Docs\\]](https://example.com/docs)\n\n- 06:30 保存链接\n");
});

test("formats capture time in the host local timezone", () => {
  const capturedAt = new Date(Date.UTC(2026, 3, 29, 6, 30)).toISOString();

  const entry = formatCaptureEntry({
    type: "url",
    title: "Local Time",
    pageUrl: "https://example.com/local-time",
    capturedAt
  });

  assert.equal(entry, `#### [Local Time](https://example.com/local-time)\n\n- ${localTime(capturedAt)} 保存链接\n`);
});

test("formats rich selected markdown only when formatting markers add information", () => {
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
    "#### [Article](https://example.com/a)\n\n- 06:31 富文本摘录\n\n## Heading\n\n**first line**\n\nsecond line\n"
  );
});

test("preserves italic markdown as rich selected content", () => {
  const entry = formatCaptureEntry({
    type: "selection",
    title: "Article",
    pageUrl: "https://example.com/a",
    text: "emphasized note",
    markdown: "*emphasized note*",
    capturedAt: localIso(2026, 4, 29, 6, 31)
  });

  assert.equal(
    entry,
    "#### [Article](https://example.com/a)\n\n- 06:31 富文本摘录\n\n*emphasized note*\n"
  );
});

test("preserves inline code and strikethrough markdown as rich selected content", () => {
  for (const markdown of ["Use `npm test`.", "Remove ~~legacy~~ text."]) {
    const entry = formatCaptureEntry({
      type: "selection",
      title: "Article",
      pageUrl: "https://example.com/a",
      text: markdown.replace(/[`~]/g, ""),
      markdown,
      capturedAt: localIso(2026, 4, 29, 6, 31)
    });

    assert.match(entry, /- 06:31 富文本摘录/);
    assert.match(entry, new RegExp(markdown.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("formats plain selected text as text under a bullet record", () => {
  const entry = formatCaptureEntry({
    type: "selection",
    title: "Article",
    pageUrl: "https://example.com/a",
    text: "first line\n  second line",
    markdown: "first line\n  second line",
    capturedAt: localIso(2026, 4, 29, 6, 31)
  });

  assert.equal(
    entry,
    "#### [Article](https://example.com/a)\n\n- 06:31 文字摘录\n\nfirst line\n  second line\n"
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

  assert.equal(entry, "#### [Article](https://example.com/a)\n\n- 06:31 文字摘录\n\n````markdown\nbefore\n```\ninside\n```\nafter\n````\n");
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

  assert.equal(entry, "#### [Code](https://example.com/code)\n\n- 06:31 文字摘录\n\n```js\nconst value = 1;\n```\n");
});

test("detects JSON selections and labels the code block", () => {
  const entry = formatCaptureEntry({
    type: "selection",
    title: "JSON",
    pageUrl: "https://example.com/json",
    text: '{\n  "name": "yishan",\n  "enabled": true\n}',
    capturedAt: localIso(2026, 4, 29, 6, 31)
  });

  assert.equal(entry, "#### [JSON](https://example.com/json)\n\n- 06:31 文字摘录\n\n```json\n{\n  \"name\": \"yishan\",\n  \"enabled\": true\n}\n```\n");
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
  assert.doesNotMatch(textEntry, /```text/);
  assert.match(textEntry, /\n这是一段普通摘录，不应该被误判为代码。\n$/);
});

test("formats a downloaded image as only an embedded Obsidian attachment", () => {
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
    "#### [Image Page](https://example.com/page)\n\n- 06:32 图片\n\n![[20260429-063200-image.jpg]]\n"
  );
  assert.doesNotMatch(entry, /来源图片|https:\/\/cdn\.example\.com\/image\.jpg/);
});

test("formats image download failure without writing the source image URL", () => {
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
    "#### [Image Page](https://example.com/page)\n\n- 06:33 图片\n\n图片下载失败：HTTP 403\n"
  );
  assert.doesNotMatch(entry, /来源图片|https:\/\/cdn\.example\.com\/image\.jpg/);
});
