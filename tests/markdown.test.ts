import assert from "node:assert/strict";
import test from "node:test";

import { formatCaptureEntry } from "../src/host/markdown.ts";

test("formats a captured URL as one timestamped markdown list item", () => {
  const entry = formatCaptureEntry({
    type: "url",
    title: "Example [Docs]",
    pageUrl: "https://example.com/docs",
    capturedAt: "2026-04-29T06:30:00.000Z"
  });

  assert.equal(entry, "- 06:30 [Example \\[Docs\\]](https://example.com/docs)\n");
});

test("formats selected text as an Obsidian fenced code block under the source link", () => {
  const entry = formatCaptureEntry({
    type: "selection",
    title: "Article",
    pageUrl: "https://example.com/a",
    text: "first line\n  second line",
    markdown: "## Heading\n\n**first line**\n\nsecond line",
    capturedAt: "2026-04-29T06:31:00.000Z"
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
    capturedAt: "2026-04-29T06:31:00.000Z"
  });

  assert.equal(entry, "- 06:31 [Article](https://example.com/a)\n\n````text\nbefore\n```\ninside\n```\nafter\n````\n");
});

test("formats a downloaded image as an embedded Obsidian attachment with original image URL", () => {
  const entry = formatCaptureEntry(
    {
      type: "image",
      title: "Image Page",
      pageUrl: "https://example.com/page",
      imageUrl: "https://cdn.example.com/image.jpg",
      capturedAt: "2026-04-29T06:32:00.000Z"
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
      capturedAt: "2026-04-29T06:33:00.000Z"
    },
    { imageError: "HTTP 403" }
  );

  assert.equal(
    entry,
    "- 06:33 [Image Page](https://example.com/page)\n  图片下载失败：HTTP 403\n  来源图片：https://cdn.example.com/image.jpg\n"
  );
});
