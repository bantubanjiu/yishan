import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadConfig } from "../src/host/config.ts";
import { formatCaptureEntry } from "../src/host/markdown.ts";
import {
  assertHostRequest,
  handleHostRequest,
  pickFolderForPlatform,
  pickFolderWithAppleScript,
  pickFolderWithPowerShell
} from "../src/host/host-request.ts";
import { normalizeSelectionRect } from "../extension/screenshot-crop.js";
import { decodeNativeMessages, encodeNativeMessage } from "../src/host/native-protocol.ts";
import { buildAppendText, buildUpdatedNoteContent, writeCaptureToVault } from "../src/host/vault-writer.ts";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function localIso(year, month, day, hour, minute, second = 0) {
  return new Date(year, month - 1, day, hour, minute, second).toISOString();
}

function localDatePath(vaultPath, year, month, day) {
  return path.join(vaultPath, "Inbox", `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}.md`);
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function localTime(isoDate) {
  const date = new Date(isoDate);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function expectAnyString(value) {
  assert.equal(typeof value, "string");
  return value;
}

test("formats a captured URL as a linked title with a timestamp child", () => {
  const entry = formatCaptureEntry({
    type: "url",
    title: "Example [Docs]",
    pageUrl: "https://example.com/docs",
    capturedAt: localIso(2026, 4, 29, 6, 30)
  });

  assert.equal(entry, "## [Example \\[Docs\\]](https://example.com/docs)\n\n### 06:30 \u4fdd\u5b58\u94fe\u63a5\n");
});

test("formats capture time in the host local timezone", () => {
  const capturedAt = new Date(Date.UTC(2026, 3, 29, 6, 30)).toISOString();

  const entry = formatCaptureEntry({
    type: "url",
    title: "Local Time",
    pageUrl: "https://example.com/local-time",
    capturedAt
  });

  assert.equal(entry, `## [Local Time](https://example.com/local-time)\n\n### ${localTime(capturedAt)} \u4fdd\u5b58\u94fe\u63a5\n`);
});

test("formats selected text as an Obsidian fenced code block under the timestamp", () => {
  const entry = formatCaptureEntry({
    type: "selection",
    title: "Article",
    pageUrl: "https://example.com/a",
    text: "first line\n  second line",
    markdown: "first line\n  second line",
    capturedAt: localIso(2026, 4, 29, 6, 31)
  });

  assert.equal(entry, "## [Article](https://example.com/a)\n\n### 06:31 \u6587\u5b57\u6458\u5f55\n\n```text\nfirst line\n  second line\n```\n");
});

test("does not treat normalized plain selection markdown as rich text", () => {
  const entry = formatCaptureEntry({
    type: "selection",
    title: "Article",
    pageUrl: "https://example.com/a",
    text: " first line \n\n  second line ",
    markdown: "first line\nsecond line",
    capturedAt: localIso(2026, 4, 29, 6, 31)
  });

  assert.equal(entry, "## [Article](https://example.com/a)\n\n### 06:31 \u6587\u5b57\u6458\u5f55\n\n```text\nfirst line \n\n  second line\n```\n");
});

test("uses a longer code fence when selected text already contains backtick fences", () => {
  const entry = formatCaptureEntry({
    type: "selection",
    title: "Article",
    pageUrl: "https://example.com/a",
    text: "before\n```\ninside\n```\nafter",
    capturedAt: localIso(2026, 4, 29, 6, 31)
  });

  assert.equal(entry, "## [Article](https://example.com/a)\n\n### 06:31 \u6587\u5b57\u6458\u5f55\n\n````text\nbefore\n```\ninside\n```\nafter\n````\n");
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

  assert.equal(entry, "## [Code](https://example.com/code)\n\n### 06:31 \u6587\u5b57\u6458\u5f55\n\n```js\nconst value = 1;\n```\n");
});

test("detects JSON selections and labels the code block", () => {
  const entry = formatCaptureEntry({
    type: "selection",
    title: "JSON",
    pageUrl: "https://example.com/json",
    text: '{\n  "name": "yishan",\n  "enabled": true\n}',
    capturedAt: localIso(2026, 4, 29, 6, 31)
  });

  assert.equal(entry, "## [JSON](https://example.com/json)\n\n### 06:31 \u6587\u5b57\u6458\u5f55\n\n```json\n{\n  \"name\": \"yishan\",\n  \"enabled\": true\n}\n```\n");
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
    "## [Image Page](https://example.com/page)\n\n### 06:32 \u56fe\u7247\n\n![[20260429-063200-image.jpg]]\n"
  );
  assert.doesNotMatch(entry, /来源图片|https:\/\/cdn\.example\.com\/image\.jpg/);
});

test("formats screenshot data URL captures as only the embedded attachment", () => {
  const entry = formatCaptureEntry(
    {
      type: "image",
      title: "Screenshot Page",
      pageUrl: "https://example.com/page",
      imageUrl: "data:image/png;base64,AQID",
      capturedAt: localIso(2026, 4, 29, 6, 34)
    },
    { attachmentName: "20260429-063400-screenshot.png" }
  );

  assert.equal(
    entry,
    "## [Screenshot Page](https://example.com/page)\n\n### 06:34 \u622a\u56fe\n\n![[20260429-063400-screenshot.png]]\n"
  );
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
    "## [Image Page](https://example.com/page)\n\n### 06:33 \u56fe\u7247\n\n\u56fe\u7247\u4e0b\u8f7d\u5931\u8d25\uff1aHTTP 403\n"
  );
  assert.doesNotMatch(entry, /来源图片|https:\/\/cdn\.example\.com\/image\.jpg/);
});

test("formats a clipped page as a standalone markdown document with source metadata", () => {
  const entry = formatCaptureEntry(
    {
      type: "page",
      title: "Article [Docs]",
      pageUrl: "https://example.com/article",
      markdown: "# Article\n\nUseful paragraph.",
      images: [],
      capturedAt: localIso(2026, 5, 7, 10, 15)
    },
    { standalone: true }
  );

  assert.equal(
    entry,
    "---\ntitle: \"Article [Docs]\"\nsource: \"https://example.com/article\"\nclipped_at: \"2026-05-07T02:15:00.000Z\"\n---\n\n# Article\n\nUseful paragraph.\n"
  );
  assert.doesNotMatch(entry, /```text/);
});

test("creates the daily inbox note when it does not exist", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));

  const result = await writeCaptureToVault(
    {
      type: "url",
      title: "Example",
      pageUrl: "https://example.com",
      capturedAt: localIso(2026, 4, 29, 8, 0)
    },
    {
      vaultPath,
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments"
    }
  );

  assert.equal(result.notePath, localDatePath(vaultPath, 2026, 4, 29));
  assert.equal(await readFile(result.notePath, "utf8"), "## [Example](https://example.com)\n\n### 08:00 \u4fdd\u5b58\u94fe\u63a5\n\n");
});

test("appends to an existing daily inbox note without overwriting prior captures", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));
  const config = {
    vaultPath,
    inboxDir: "Inbox",
    attachmentsDir: "Inbox/attachments"
  };

  await writeCaptureToVault(
    {
      type: "url",
      title: "First",
      pageUrl: "https://example.com/1",
      capturedAt: localIso(2026, 4, 29, 8, 0)
    },
    config
  );
  await writeCaptureToVault(
    {
      type: "selection",
      title: "Second",
      pageUrl: "https://example.com/2",
      text: "useful note",
      capturedAt: localIso(2026, 4, 29, 8, 1)
    },
    config
  );

  const content = await readFile(localDatePath(vaultPath, 2026, 4, 29), "utf8");
  assert.equal(
    content,
    "## [First](https://example.com/1)\n\n### 08:00 \u4fdd\u5b58\u94fe\u63a5\n\n## [Second](https://example.com/2)\n\n### 08:01 \u6587\u5b57\u6458\u5f55\n\n```text\nuseful note\n```\n\n"
  );
});

test("appends same-day captures from the same page URL under linked titles", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));
  const config = {
    vaultPath,
    inboxDir: "Inbox",
    attachmentsDir: "Inbox/attachments"
  };

  await writeCaptureToVault(
    {
      type: "url",
      title: "Example [Docs]",
      pageUrl: "https://example.com/docs",
      capturedAt: localIso(2026, 4, 29, 8, 0)
    },
    config
  );
  await writeCaptureToVault(
    {
      type: "selection",
      title: "Renamed Tab",
      pageUrl: "https://example.com/docs",
      text: "same page excerpt",
      capturedAt: localIso(2026, 4, 29, 8, 5)
    },
    config
  );

  const content = await readFile(localDatePath(vaultPath, 2026, 4, 29), "utf8");
  assert.equal(
    content,
    "## [Example \\[Docs\\]](https://example.com/docs)\n\n### 08:00 \u4fdd\u5b58\u94fe\u63a5\n\n### 08:05 \u6587\u5b57\u6458\u5f55\n\n```text\nsame page excerpt\n```\n\n"
  );
  assert.equal(content.match(/^## /gm)?.length ?? 0, 1);
});

test("groups same-day URL, text, rich text, screenshot, and image captures under one page link", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));
  const config = {
    vaultPath,
    inboxDir: "Inbox",
    attachmentsDir: "Inbox/attachments"
  };
  const pageUrl = "https://example.com/docs";

  await writeCaptureToVault(
    {
      type: "url",
      title: "Example [Docs]",
      pageUrl,
      capturedAt: localIso(2026, 4, 29, 8, 0)
    },
    config
  );
  await writeCaptureToVault(
    {
      type: "selection",
      title: "Renamed Tab",
      pageUrl,
      text: "plain excerpt",
      capturedAt: localIso(2026, 4, 29, 8, 5)
    },
    config
  );
  await writeCaptureToVault(
    {
      type: "selection",
      title: "Renamed Tab",
      pageUrl,
      text: "rich excerpt",
      markdown: "**rich excerpt**",
      capturedAt: localIso(2026, 4, 29, 8, 6)
    },
    config
  );
  const screenshot = await writeCaptureToVault(
    {
      type: "image",
      title: "Renamed Tab",
      pageUrl,
      imageUrl: "data:image/png;base64,AQID",
      capturedAt: localIso(2026, 4, 29, 8, 7)
    },
    config
  );
  const image = await writeCaptureToVault(
    {
      type: "image",
      title: "Renamed Tab",
      pageUrl,
      imageUrl: "https://cdn.example.com/image.jpg",
      capturedAt: localIso(2026, 4, 29, 8, 8)
    },
    config,
    {
      fetchBinary: async () => ({
        bytes: new Uint8Array([4, 5, 6]),
        contentType: "image/jpeg"
      })
    }
  );

  const content = await readFile(localDatePath(vaultPath, 2026, 4, 29), "utf8");
  assert.equal(content.match(/^## \[Example \\\[Docs\\\]\]\(https:\/\/example\.com\/docs\)$/gm)?.length ?? 0, 1);
  assert.equal(
    content,
    `## [Example \\[Docs\\]](${pageUrl})\n\n` +
      "### 08:00 保存链接\n\n" +
      "### 08:05 文字摘录\n\n" +
      "```text\nplain excerpt\n```\n\n" +
      "### 08:06 富文本摘录\n\n" +
      "**rich excerpt**\n\n" +
      "### 08:07 截图\n\n" +
      `![[${screenshot.attachmentName}]]\n\n` +
      "### 08:08 图片\n\n" +
      `![[${image.attachmentName}]]\n\n`
  );
});

test("appends after existing grouped headings without rewriting previous content", () => {
  assert.equal(
    buildUpdatedNoteContent(
      "## Legacy \\[Docs\\]\n来源：https://example.com/docs\n\n- 08:00 保存链接\n\nmanual note\n",
      {
        type: "selection",
        title: "Renamed Tab",
        pageUrl: "https://example.com/docs",
        text: "same page excerpt",
        capturedAt: localIso(2026, 4, 29, 8, 5)
      },
      "### 08:05 \u6587\u5b57\u6458\u5f55\n\n```text\nsame page excerpt\n```\n"
    ),
    "## Legacy \\[Docs\\]\n\u6765\u6e90\uff1ahttps://example.com/docs\n\n- 08:00 \u4fdd\u5b58\u94fe\u63a5\n\nmanual note\n\n## [Renamed Tab](https://example.com/docs)\n\n### 08:05 \u6587\u5b57\u6458\u5f55\n\n```text\nsame page excerpt\n```\n\n"
  );
});

test("keeps legacy source link entries and appends the next linked title entry", () => {
  assert.equal(
    buildUpdatedNoteContent(
      "- 08:00 [Legacy \\[Docs\\]](https://example.com/docs)\n\nmanual note\n",
      {
        type: "selection",
        title: "Renamed Tab",
        pageUrl: "https://example.com/docs",
        text: "same page excerpt",
        capturedAt: localIso(2026, 4, 29, 8, 5)
      },
      "### 08:05 \u6587\u5b57\u6458\u5f55\n\n```text\nsame page excerpt\n```\n"
    ),
    "- 08:00 [Legacy \\[Docs\\]](https://example.com/docs)\n\nmanual note\n\n## [Renamed Tab](https://example.com/docs)\n\n### 08:05 \u6587\u5b57\u6458\u5f55\n\n```text\nsame page excerpt\n```\n\n"
  );
});

test("serializes concurrent writes to the same daily note without dropping captures", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));
  const config = {
    vaultPath,
    inboxDir: "Inbox",
    attachmentsDir: "Inbox/attachments"
  };

  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      writeCaptureToVault(
        {
          type: "url",
          title: `Page ${index}`,
          pageUrl: `https://example.com/${index}`,
          capturedAt: localIso(2026, 4, 29, 8, index)
        },
        config
      )
    )
  );

  const content = await readFile(localDatePath(vaultPath, 2026, 4, 29), "utf8");
  for (let index = 0; index < 8; index += 1) {
    assert.match(content, new RegExp(`## \\[Page ${index}\\]\\(https://example\\.com/${index}\\)\\n\\n### 08:0${index} \u4fdd\u5b58\u94fe\u63a5`));
  }
});

test("keeps captures from the same URL on different local dates in separate daily notes", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));
  const config = {
    vaultPath,
    inboxDir: "Inbox",
    attachmentsDir: "Inbox/attachments"
  };

  await writeCaptureToVault(
    {
      type: "url",
      title: "Example",
      pageUrl: "https://example.com/docs",
      capturedAt: localIso(2026, 4, 29, 23, 59)
    },
    config
  );
  await writeCaptureToVault(
    {
      type: "url",
      title: "Example",
      pageUrl: "https://example.com/docs",
      capturedAt: localIso(2026, 4, 30, 0, 1)
    },
    config
  );

  assert.equal(
    await readFile(localDatePath(vaultPath, 2026, 4, 29), "utf8"),
    "## [Example](https://example.com/docs)\n\n### 23:59 \u4fdd\u5b58\u94fe\u63a5\n\n"
  );
  assert.equal(
    await readFile(localDatePath(vaultPath, 2026, 4, 30), "utf8"),
    "## [Example](https://example.com/docs)\n\n### 00:01 \u4fdd\u5b58\u94fe\u63a5\n\n"
  );
});

test("closes an unclosed fenced code block before appending a new capture", () => {
  assert.equal(
    buildAppendText("manual paste\n```*\nnot closed", "### 08:05 \u622a\u56fe\n\n![[shot.png]]\n"),
    "\n\n```\n\n### 08:05 \u622a\u56fe\n\n![[shot.png]]\n\n"
  );
});

test("closes an unclosed manual fenced block before appending a new linked title entry", () => {
  assert.equal(
    buildUpdatedNoteContent(
      "manual paste\n```*\nnot closed",
      {
        type: "url",
        title: "Example",
        pageUrl: "https://example.com",
        capturedAt: localIso(2026, 4, 29, 8, 0)
      },
      "### 08:00 \u4fdd\u5b58\u94fe\u63a5\n"
    ),
    "manual paste\n```*\nnot closed\n\n```\n\n## [Example](https://example.com)\n\n### 08:00 \u4fdd\u5b58\u94fe\u63a5\n\n"
  );
});

test("separates new captures from existing text that has no trailing newline", () => {
  assert.equal(
    buildAppendText("manual paste without newline", "### 08:06 \u4fdd\u5b58\u94fe\u63a5\n"),
    "\n\n### 08:06 \u4fdd\u5b58\u94fe\u63a5\n\n"
  );
});

test("decodes data URL images into attachments for screenshot captures", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));

  const result = await writeCaptureToVault(
    {
      type: "image",
      title: "Screenshot",
      pageUrl: "https://example.com/page",
      imageUrl: "data:image/png;base64,AQID",
      capturedAt: localIso(2026, 4, 29, 8, 4)
    },
    {
      vaultPath,
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments"
    }
  );

  assert.match(result.attachmentName ?? "", /^20260429-080400-[a-f0-9]{8}\.png$/);
  const attachmentPath = path.join(vaultPath, "Inbox", "attachments", result.attachmentName ?? "");
  assert.deepEqual(new Uint8Array(await readFile(attachmentPath)), new Uint8Array([1, 2, 3]));
});

test("loads older config files with the default selection modifier", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "clipper-config-"));
  const configPath = path.join(tempDir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      vaultPath: path.join(tempDir, "vault"),
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments"
    }),
    "utf8"
  );

  assert.deepEqual(await loadConfig(configPath), {
    vaultPath: path.join(tempDir, "vault"),
    inboxDir: "Inbox",
    attachmentsDir: "Inbox/attachments",
    selectionModifier: "Alt",
    selectionGestureEnabled: false,
    selectionSaveMode: "plain"
  });
});

test("normalizes drag screenshot selection into viewport-clamped bitmap coordinates", () => {
  assert.deepEqual(
    normalizeSelectionRect({ x: 300, y: 250 }, { x: 100, y: 50 }, { width: 500, height: 400 }, 2),
    {
      css: { x: 100, y: 50, width: 200, height: 200 },
      bitmap: { x: 200, y: 100, width: 400, height: 400 }
    }
  );
});

test("clamps drag screenshot selection to the visible viewport", () => {
  assert.deepEqual(
    normalizeSelectionRect({ x: -10, y: 20 }, { x: 120, y: 90 }, { width: 100, height: 80 }, 1.5),
    {
      css: { x: 0, y: 20, width: 100, height: 60 },
      bitmap: { x: 0, y: 30, width: 150, height: 90 }
    }
  );
});

test("downloads a captured image into the configured attachments directory", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));

  const result = await writeCaptureToVault(
    {
      type: "image",
      title: "Image",
      pageUrl: "https://example.com/page",
      imageUrl: "https://cdn.example.com/image.png",
      capturedAt: localIso(2026, 4, 29, 8, 2)
    },
    {
      vaultPath,
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments"
    },
    {
      fetchBinary: async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/png"
      })
    }
  );

  assert.match(result.attachmentName ?? "", /^20260429-080200-[a-f0-9]{8}\.png$/);
  const attachmentPath = path.join(vaultPath, "Inbox", "attachments", result.attachmentName ?? "");
  assert.deepEqual(new Uint8Array(await readFile(attachmentPath)), new Uint8Array([1, 2, 3]));
  assert.equal((await stat(attachmentPath)).isFile(), true);
});

test("rejects non-image remote responses while still writing the markdown capture", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("<html>not an image</html>", {
      status: 200,
      headers: {
        "content-type": "text/html"
      }
    });

  try {
    const result = await writeCaptureToVault(
      {
        type: "image",
        title: "Remote HTML",
        pageUrl: "https://example.com/page",
        imageUrl: "https://cdn.example.com/not-image",
        capturedAt: localIso(2026, 5, 7, 9, 0)
      },
      {
        vaultPath,
        inboxDir: "Inbox",
        attachmentsDir: "Inbox/attachments"
      }
    );

    assert.equal(result.attachmentName, undefined);
    assert.equal(
      await readFile(localDatePath(vaultPath, 2026, 5, 7), "utf8"),
      "## [Remote HTML](https://example.com/page)\n\n### 09:00 \u56fe\u7247\n\n\u56fe\u7247\u4e0b\u8f7d\u5931\u8d25\uff1a\u54cd\u5e94\u4e0d\u662f\u56fe\u7247\u5185\u5bb9\n\n"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects oversized remote images before writing attachments", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(20 * 1024 * 1024 + 1)
      }
    });

  try {
    const result = await writeCaptureToVault(
      {
        type: "image",
        title: "Huge Image",
        pageUrl: "https://example.com/page",
        imageUrl: "https://cdn.example.com/huge.png",
        capturedAt: localIso(2026, 5, 7, 9, 1)
      },
      {
        vaultPath,
        inboxDir: "Inbox",
        attachmentsDir: "Inbox/attachments"
      }
    );

    assert.equal(result.attachmentName, undefined);
    assert.match(await readFile(localDatePath(vaultPath, 2026, 5, 7), "utf8"), /图片下载失败：图片体积超过 20MB/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects non-image and oversized data URLs without blocking markdown writes", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));

  await writeCaptureToVault(
    {
      type: "image",
      title: "Text Data",
      pageUrl: "https://example.com/page",
      imageUrl: "data:text/plain;base64,aGVsbG8=",
      capturedAt: localIso(2026, 5, 7, 9, 2)
    },
    {
      vaultPath,
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments"
    }
  );

  await writeCaptureToVault(
    {
      type: "image",
      title: "Huge Data",
      pageUrl: "https://example.com/page",
      imageUrl: `data:image/png;base64,${Buffer.alloc(20 * 1024 * 1024 + 1).toString("base64")}`,
      capturedAt: localIso(2026, 5, 7, 9, 3)
    },
    {
      vaultPath,
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments"
    }
  );

  const content = await readFile(localDatePath(vaultPath, 2026, 5, 7), "utf8");
  assert.match(content, /## \[Text Data\]\(https:\/\/example\.com\/page\)\n\n### 09:02 \u56fe\u7247\n\n\u56fe\u7247\u4e0b\u8f7d\u5931\u8d25\uff1aInvalid data URL/);
  assert.match(content, /### 09:03 \u622a\u56fe\n\n\u56fe\u7247\u4e0b\u8f7d\u5931\u8d25\uff1a\u56fe\u7247\u4f53\u79ef\u8d85\u8fc7 20MB/);
  assert.doesNotMatch(content, /来源图片|https:\/\/cdn\.example\.com/);
});

test("writes clipped pages to standalone notes without updating the daily inbox", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));

  const result = await writeCaptureToVault(
    {
      type: "page",
      title: "Example Article",
      pageUrl: "https://example.com/articles/1",
      markdown: "# Example Article\n\nUseful body.",
      images: [],
      capturedAt: localIso(2026, 5, 7, 10, 15)
    },
    {
      vaultPath,
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments"
    }
  );

  assert.equal(result.notePath, path.join(vaultPath, "Inbox", "Example Article-20260507-101500.md"));
  assert.equal(await pathExists(localDatePath(vaultPath, 2026, 5, 7)), false);
  assert.equal(
    await readFile(result.notePath, "utf8"),
    "---\ntitle: \"Example Article\"\nsource: \"https://example.com/articles/1\"\nclipped_at: \"2026-05-07T02:15:00.000Z\"\n---\n\n# Example Article\n\nUseful body.\n"
  );
});

test("localizes clipped page images and replaces markdown references with Obsidian embeds", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));

  const result = await writeCaptureToVault(
    {
      type: "page",
      title: "Image Article",
      pageUrl: "https://example.com/article",
      markdown: "# Image Article\n\n![Hero](https://cdn.example.com/hero.png)\n\n![Inline](https://cdn.example.com/inline.jpg)",
      images: [
        { url: "https://cdn.example.com/hero.png", alt: "Hero" },
        { url: "https://cdn.example.com/inline.jpg", alt: "Inline" }
      ],
      capturedAt: localIso(2026, 5, 7, 10, 20)
    },
    {
      vaultPath,
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments"
    },
    {
      fetchBinary: async (url) => ({
        bytes: url.endsWith("hero.png") ? new Uint8Array([1, 2, 3]) : new Uint8Array([4, 5, 6]),
        contentType: url.endsWith("hero.png") ? "image/png" : "image/jpeg"
      })
    }
  );

  assert.equal(result.attachments?.length, 2);
  assert.match(result.attachments?.[0] ?? "", /^20260507-102000-[a-f0-9]{8}\.png$/);
  assert.match(result.attachments?.[1] ?? "", /^20260507-102000-[a-f0-9]{8}\.jpg$/);
  assert.deepEqual(
    new Uint8Array(await readFile(path.join(vaultPath, "Inbox", "attachments", result.attachments[0]))),
    new Uint8Array([1, 2, 3])
  );
  assert.deepEqual(
    new Uint8Array(await readFile(path.join(vaultPath, "Inbox", "attachments", result.attachments[1]))),
    new Uint8Array([4, 5, 6])
  );

  const content = await readFile(result.notePath, "utf8");
  assert.match(content, new RegExp(`!\\[\\[${result.attachments[0]}\\]\\]`));
  assert.match(content, new RegExp(`!\\[\\[${result.attachments[1]}\\]\\]`));
  assert.doesNotMatch(content, /https:\/\/cdn\.example\.com\/(?:hero|inline)/);
});

test("keeps clipped page markdown writable when image localization fails", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));

  const result = await writeCaptureToVault(
    {
      type: "page",
      title: "Broken Image Article",
      pageUrl: "https://example.com/article",
      markdown: "# Broken\n\n![Hero](https://cdn.example.com/hero.png)",
      images: [{ url: "https://cdn.example.com/hero.png", alt: "Hero" }],
      capturedAt: localIso(2026, 5, 7, 10, 21)
    },
    {
      vaultPath,
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments"
    },
    {
      fetchBinary: async () => {
        throw new Error("HTTP 403");
      }
    }
  );

  assert.equal(result.attachments?.length ?? 0, 0);
  const content = await readFile(result.notePath, "utf8");
  assert.match(content, /!\[Hero\]\(https:\/\/cdn\.example\.com\/hero\.png\)/);
  assert.match(content, /> 图片本地化失败：\[Hero\]\(https:\/\/cdn\.example\.com\/hero\.png\) - HTTP 403/);
});

test("rejects inbox paths that escape the configured vault", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));

  await assert.rejects(
    () =>
      writeCaptureToVault(
        {
          type: "url",
          title: "Bad",
          pageUrl: "https://example.com",
          capturedAt: localIso(2026, 4, 29, 8, 3)
        },
        {
          vaultPath,
          inboxDir: "../outside",
          attachmentsDir: "Inbox/attachments"
        }
      ),
    /must stay inside the vault/
  );
});

test("encodes native messaging JSON with a 4-byte little-endian length prefix", () => {
  const encoded = encodeNativeMessage({ ok: true, notePath: "Inbox/2026-04-29.md" });

  assert.equal(encoded.readUInt32LE(0), encoded.length - 4);
  assert.equal(encoded.subarray(4).toString("utf8"), '{"ok":true,"notePath":"Inbox/2026-04-29.md"}');
});

test("decodes one or more native messaging frames", () => {
  const first = encodeNativeMessage({
    type: "url",
    title: "A",
    pageUrl: "https://a.test",
    capturedAt: "2026-04-29T00:00:00.000Z"
  });
  const second = encodeNativeMessage({
    type: "selection",
    title: "B",
    pageUrl: "https://b.test",
    text: "hello",
    capturedAt: "2026-04-29T00:01:00.000Z"
  });

  assert.deepEqual(decodeNativeMessages(Buffer.concat([first, second])), [
    { type: "url", title: "A", pageUrl: "https://a.test", capturedAt: "2026-04-29T00:00:00.000Z" },
    { type: "selection", title: "B", pageUrl: "https://b.test", text: "hello", capturedAt: "2026-04-29T00:01:00.000Z" }
  ]);
});

test("rejects incomplete native messaging frames", () => {
  const encoded = encodeNativeMessage({ ok: true });

  assert.throws(() => decodeNativeMessages(encoded.subarray(0, encoded.length - 1)), /Incomplete native message frame/);
});

test("host request handler can save and read configuration", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "clipper-config-"));
  const configPath = path.join(tempDir, "config.json");
  const config = {
    vaultPath: path.join(tempDir, "vault"),
    inboxDir: "Inbox",
    attachmentsDir: "Inbox/attachments"
  };

  assert.deepEqual(await handleHostRequest({ type: "set-config", config }, configPath), { ok: true });
  assert.deepEqual(await handleHostRequest({ type: "get-config" }, configPath), {
    ok: true,
    config: { ...config, selectionModifier: "Alt", selectionGestureEnabled: false, selectionSaveMode: "plain" }
  });
});

test("accepts pick-folder native requests", () => {
  assert.deepEqual(assertHostRequest({ type: "pick-folder", initialPath: "C:\\Vault" }), {
    type: "pick-folder",
    initialPath: "C:\\Vault"
  });
});

test("host request schema sanitizes URL captures and falls back empty titles to Untitled", () => {
  const sanitized = assertHostRequest({
    type: "url",
    title: "   ",
    pageUrl: "https://example.com/page",
    capturedAt: "2026-05-07T00:00:00.000Z",
    unexpected: "must not pass through"
  });

  assert.deepEqual(sanitized, {
    type: "url",
    title: "Untitled",
    pageUrl: "https://example.com/page",
    capturedAt: "2026-05-07T00:00:00.000Z"
  });
});

test("host request schema sanitizes clipped page captures", () => {
  const sanitized = assertHostRequest({
    type: "page",
    title: " Article ",
    pageUrl: "https://example.com/article",
    markdown: "  # Article\n\nBody.  ",
    images: [
      { url: "https://cdn.example.com/hero.png", alt: " Hero " },
      { url: "javascript:alert(1)", alt: "Bad" },
      { url: "https://cdn.example.com/inline", alt: 42 },
      { src: "https://cdn.example.com/ignored.png" }
    ],
    capturedAt: "2026-05-07T00:00:00.000Z",
    extra: "ignored"
  });

  assert.deepEqual(sanitized, {
    type: "page",
    title: "Article",
    pageUrl: "https://example.com/article",
    markdown: "# Article\n\nBody.",
    images: [
      { url: "https://cdn.example.com/hero.png", alt: "Hero" },
      { url: "https://cdn.example.com/inline" }
    ],
    capturedAt: "2026-05-07T00:00:00.000Z"
  });
});

test("host request schema rejects clipped pages without markdown body", () => {
  assert.throws(
    () =>
      assertHostRequest({
        type: "page",
        title: "Blank",
        pageUrl: "https://example.com/article",
        markdown: "   ",
        capturedAt: "2026-05-07T00:00:00.000Z"
      }),
    /markdown/
  );
});

test("host request schema rejects unsafe page URLs and invalid timestamps", () => {
  assert.throws(
    () =>
      assertHostRequest({
        type: "url",
        title: "Bad URL",
        pageUrl: "javascript:alert(1)",
        capturedAt: "2026-05-07T00:00:00.000Z"
      }),
    /pageUrl/
  );

  assert.throws(
    () =>
      assertHostRequest({
        type: "url",
        title: "Bad Time",
        pageUrl: "https://example.com/page",
        capturedAt: "not-a-date"
      }),
    /capturedAt/
  );
});

test("host request schema sanitizes selection, image, config, and pick-folder payloads", () => {
  const longTitle = "x".repeat(305);
  assert.deepEqual(assertHostRequest({
    type: "selection",
    title: longTitle,
    pageUrl: "file:///Users/me/Documents/page.html",
    text: " hello ",
    markdown: "**hello**",
    codeLanguage: "language-js",
    capturedAt: "2026-05-07T00:01:00.000Z",
    extra: true
  }), {
    type: "selection",
    title: "x".repeat(300),
    pageUrl: "file:///Users/me/Documents/page.html",
    text: " hello ",
    markdown: "**hello**",
    codeLanguage: "language-js",
    capturedAt: "2026-05-07T00:01:00.000Z"
  });

  assert.deepEqual(assertHostRequest({
    type: "image",
    title: "Image",
    pageUrl: "https://example.com/page",
    imageUrl: "data:image/png;base64,AQID",
    capturedAt: "2026-05-07T00:02:00.000Z",
    extra: "ignored"
  }), {
    type: "image",
    title: "Image",
    pageUrl: "https://example.com/page",
    imageUrl: "data:image/png;base64,AQID",
    capturedAt: "2026-05-07T00:02:00.000Z"
  });

  assert.deepEqual(assertHostRequest({
    type: "set-config",
    config: {
      vaultPath: "D:\\Notes",
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments",
      selectionModifier: "Meta",
      selectionGestureEnabled: true,
      unknown: "ignored"
    },
    extra: "ignored"
  }), {
    type: "set-config",
    config: {
      vaultPath: "D:\\Notes",
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments",
      selectionModifier: "Meta",
      selectionGestureEnabled: true
    }
  });

  assert.deepEqual(assertHostRequest({
    type: "pick-folder",
    initialPath: "/Users/me/Vault",
    purpose: "vaultPath"
  }), {
    type: "pick-folder",
    initialPath: "/Users/me/Vault"
  });
});

test("host request schema rejects invalid image URLs and invalid config payloads", () => {
  assert.throws(
    () =>
      assertHostRequest({
        type: "image",
        title: "Bad Image",
        pageUrl: "https://example.com/page",
        imageUrl: "https://example.com/not-image.txt",
        capturedAt: "2026-05-07T00:02:00.000Z"
      }),
    /imageUrl/
  );

  assert.throws(
    () =>
      assertHostRequest({
        type: "set-config",
        config: {
          vaultPath: "",
          inboxDir: "Inbox",
          attachmentsDir: "Inbox/attachments"
        }
      }),
    /config\.vaultPath/
  );
});

test("batch-save-tabs schema sanitizes tabs and host saves each valid tab in one request", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));
  const configPath = path.join(await mkdtemp(path.join(tmpdir(), "clipper-config-")), "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      vaultPath,
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments"
    }),
    "utf8"
  );

  const request = assertHostRequest({
    type: "batch-save-tabs",
    tabs: [
      {
        title: "Page A",
        pageUrl: "https://example.com/a",
        capturedAt: "2026-05-07T00:00:00.000Z",
        ignored: true
      },
      {
        title: "",
        pageUrl: "file:///D:/docs/b.pdf",
        capturedAt: "2026-05-07T00:00:01.000Z"
      }
    ],
    ignored: true
  });

  assert.deepEqual(request, {
    type: "batch-save-tabs",
    tabs: [
      {
        type: "url",
        title: "Page A",
        pageUrl: "https://example.com/a",
        capturedAt: "2026-05-07T00:00:00.000Z"
      },
      {
        type: "url",
        title: "Untitled",
        pageUrl: "file:///D:/docs/b.pdf",
        capturedAt: "2026-05-07T00:00:01.000Z"
      }
    ]
  });

  const response = await handleHostRequest(request, configPath);

  assert.deepEqual(response, { ok: true, saved: 2, failed: 0, failures: [] });
  const content = await readFile(localDatePath(vaultPath, 2026, 5, 7), "utf8");
  assert.match(content, /\[Page A\]\(https:\/\/example\.com\/a\)/);
  assert.match(content, /\[Untitled\]\(file:\/\/\/D:\/docs\/b\.pdf\)/);
});

test("batch-save-tabs returns per-tab failures without blocking successful saves", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));
  const configPath = path.join(await mkdtemp(path.join(tmpdir(), "clipper-config-")), "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      vaultPath,
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments"
    }),
    "utf8"
  );

  const response = await handleHostRequest(
    {
      type: "batch-save-tabs",
      tabs: [
        {
          type: "url",
          title: "Good",
          pageUrl: "https://example.com/good",
          capturedAt: "2026-05-07T00:00:00.000Z"
        },
        {
          type: "url",
          title: "Bad",
          pageUrl: "https://example.com/bad",
          capturedAt: "not-a-date"
        }
      ]
    },
    configPath
  );

  assert.equal(response.ok, true);
  assert.equal(response.saved, 1);
  assert.equal(response.failed, 1);
  assert.deepEqual(response.failures, [
    {
      title: "Bad",
      pageUrl: "https://example.com/bad",
      error: "Invalid capturedAt timestamp: not-a-date"
    }
  ]);
  assert.match(await readFile(localDatePath(vaultPath, 2026, 5, 7), "utf8"), /\[Good\]\(https:\/\/example\.com\/good\)/);
});

test("host request handler opens today inbox through Obsidian URI only", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));
  const configPath = path.join(await mkdtemp(path.join(tmpdir(), "clipper-config-")), "config.json");
  const today = new Date();
  const inboxPath = localDatePath(vaultPath, today.getFullYear(), today.getMonth() + 1, today.getDate());
  await mkdir(path.dirname(inboxPath), { recursive: true });
  await writeFile(inboxPath, "# Inbox\n", "utf8");
  await writeFile(
    configPath,
    JSON.stringify({
      vaultPath,
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments"
    }),
    "utf8"
  );
  const opened = [];

  assert.deepEqual(
    await handleHostRequest({ type: "open-path", target: "today-inbox" }, configPath, {
      openPath: async (targetPath) => {
        opened.push(targetPath);
      }
    }),
    { ok: true, path: inboxPath }
  );

  assert.equal(opened[0], `obsidian://open?path=${encodeURIComponent(inboxPath)}`);
  for (const target of ["attachments", "vault", "config", "..\\outside"]) {
    assert.throws(() => assertHostRequest({ type: "open-path", target }), /open-path target/);
  }
});

test("host request handler returns selected folder from injected picker", async () => {
  assert.deepEqual(
    await handleHostRequest(
      { type: "pick-folder", initialPath: "C:\\Vault" },
      undefined,
      {
        pickFolder: async (initialPath) => {
          assert.equal(initialPath, "C:\\Vault");
          return "D:\\Notes";
        }
      }
    ),
    { ok: true, path: "D:\\Notes" }
  );
});

test("host request handler returns the localized cancel error when folder picking is cancelled", async () => {
  assert.deepEqual(
    await handleHostRequest(
      { type: "pick-folder" },
      undefined,
      {
        pickFolder: async () => undefined
      }
    ),
    { ok: false, error: "用户取消选择文件夹" }
  );
});

test("folder picker selects the native implementation for Windows and macOS", () => {
  assert.equal(pickFolderForPlatform("win32"), pickFolderWithPowerShell);
  assert.equal(pickFolderForPlatform("darwin"), pickFolderWithAppleScript);
});

test("native host opens Obsidian URI through the platform URL handler", async () => {
  const hostRequest = await readFile(new URL("../src/host/host-request.ts", import.meta.url), "utf8");

  assert.match(hostRequest, new RegExp("obsidian://open[?]path="));
  assert.match(hostRequest, /url\.dll,FileProtocolHandler/);
});

test("macOS folder picker invokes osascript and trims selected POSIX path", async () => {
  const selectedPath = await pickFolderWithAppleScript("/Users/me/Vault", async (file, args, options) => {
    assert.equal(file, "osascript");
    assert.deepEqual(args.slice(0, 2), ["-e", expectAnyString(args[1])]);
    assert.equal(options?.env?.OBSIDIAN_CLIPPER_INITIAL_PATH, "/Users/me/Vault");
    return { stdout: "/Users/me/Notes\n" };
  });

  assert.equal(selectedPath, "/Users/me/Notes");
});

test("macOS native host install registers user Chrome and Edge manifests", async () => {
  const script = await readFile(new URL("../scripts/install-native-host-macos.sh", import.meta.url), "utf8");

  assert.match(script, /Google\/Chrome\/NativeMessagingHosts/);
  assert.match(script, /Microsoft Edge\/NativeMessagingHosts/);
  assert.match(script, /exec "\$node_path" "\$active_host_dir\/index\.ts"/);
  assert.match(script, /chmod 755 "\$launcher_path"/);
  assert.match(script, /allowed_origins/);
});

test("native host install defaults to running host code from the repository", async () => {
  const script = await readFile(new URL("../scripts/install-native-host.ps1", import.meta.url), "utf8");

  assert.match(script, /param\([\s\S]*\[switch\]\$Snapshot/);
  assert.match(script, /\$activeHostDir\s*=\s*if \(\$Snapshot\) \{ \$hostInstallDir \} else \{ \$repoHostDir \}/);
  assert.match(script, /psi\.Arguments = "\\""\s*\+\s*@"\$activeHostDir\\handle-json-file\.ts"/);
});

test("native host install only copies host files for explicit snapshot installs", async () => {
  const script = await readFile(new URL("../scripts/install-native-host.ps1", import.meta.url), "utf8");

  assert.doesNotMatch(script, /Copy-Item -Recurse -Force -Path \(Join-Path \$repoRoot "src\\host\\\*"\) -Destination \$hostInstallDir/);
  assert.match(script, /if \(\$Snapshot\)[\s\S]*Copy-Item -Recurse -Force/);
});

test("extension manifest exposes popup and keyboard commands", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));

  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal("host_permissions" in manifest, false);
  assert.equal(manifest.commands["quick-save-current-window"].suggested_key.default, "Alt+Shift+S");
  assert.equal(manifest.commands["capture-screenshot-area"].suggested_key.default, "Alt+Shift+X");
});

test("context menu places screenshot above clipped page save and page save builds a page clip", async () => {
  const contextMenu = await readFile(new URL("../extension/context-menu.js", import.meta.url), "utf8");
  const pageClipper = await readFile(new URL("../extension/page-clip.js", import.meta.url), "utf8");

  assert.ok(contextMenu.indexOf('id: "save-screenshot"') < contextMenu.indexOf('id: "save-url"'));
  assert.match(contextMenu, /from "\.\/page-clip\.js"/);
  assert.match(contextMenu, /buildPageClip\(tab\)/);
  assert.match(pageClipper, /type:\s*"page"/);
});

test("page clipper extracts readable markdown and absolute image URLs", async () => {
  const pageClipper = await readFile(new URL("../extension/page-clip.js", import.meta.url), "utf8");

  assert.match(pageClipper, /querySelector\("article,\s*main,\s*\[role='main'\]"\)/);
  assert.match(pageClipper, /script,\s*style,\s*noscript,\s*nav,\s*header,\s*footer,\s*form,\s*iframe/);
  assert.match(pageClipper, /new URL\(value,\s*document\.baseURI\)/);
  assert.match(pageClipper, /nodeToMarkdown/);
  assert.match(pageClipper, /images/);
});

test("extension background gates gesture injection behind explicit enablement and active-tab sync", async () => {
  const background = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");

  assert.match(background, /from "\.\/context-menu\.js"/);
  assert.match(background, /from "\.\/commands\.js"/);
  assert.match(background, /from "\.\/native-client\.js"/);
  assert.match(background, /from "\.\/screenshot\.js"/);
  assert.match(background, /from "\.\/selection-markdown\.js"/);
  assert.match(background, /from "\.\/gesture\.js"/);
  assert.match(background, /from "\.\/batch-save\.js"/);
  assert.match(background, /from "\.\/config-client\.js"/);
  const constants = await readFile(new URL("../extension/constants.js", import.meta.url), "utf8");
  const configClient = await readFile(new URL("../extension/config-client.js", import.meta.url), "utf8");
  const gesture = await readFile(new URL("../extension/gesture.js", import.meta.url), "utf8");
  assert.match(constants, /selectionModifier:\s*"Alt"/);
  assert.match(constants, /selectionGestureEnabled:\s*false/);
  assert.match(configClient, /normalizeSelectionModifier\(config\.selectionModifier \|\| config\.gestureModifier\)/);
  assert.match(gesture, /modifier:\s*gestureConfig\.selectionModifier/);
  assert.match(background, /syncSelectionGestureForActiveTab/);
  assert.match(background, /syncSelectionGestureForTab/);
  assert.match(background, /chrome\.tabs\.onActivated\.addListener/);
  assert.match(background, /chrome\.tabs\.onUpdated\.addListener/);
  assert.match(background, /chrome\.windows\.onFocusChanged\.addListener/);
  assert.match(background, /chrome\.windows\.WINDOW_ID_NONE/);
  assert.match(gesture, /isGestureScriptableTab/);
  assert.doesNotMatch(gesture, /modifier:\s*DEFAULT_SETTINGS\.gestureModifier/);
});

test("extension popup presents a capture console and keeps full settings in options", async () => {
  const popupHtml = await readFile(new URL("../extension/popup.html", import.meta.url), "utf8");
  const popupJs = await readFile(new URL("../extension/popup.js", import.meta.url), "utf8");
  const optionsHtml = await readFile(new URL("../extension/options.html", import.meta.url), "utf8");
  const optionsJs = await readFile(new URL("../extension/options.js", import.meta.url), "utf8");
  const background = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");

  for (const expected of [
    "saveCurrentPage",
    "保存当前页面",
    "采集控制台",
    "saveCurrentWindow",
    "保存当前窗口标签",
    "captureScreenshot",
    "保存当前视口",
    "vaultState",
    "gestureSummary",
    "modeSummary",
    "更多保存方式",
    "选中文本右键",
    "图片右键",
    "Alt\\+Shift\\+S",
    "Alt\\+Shift\\+X",
    "openOptions",
    "打开今天 Inbox"
  ]) {
    assert.match(popupHtml, new RegExp(expected));
  }

  for (const removed of [
    "saveCurrentTab",
    "savePdfLink",
    "\u4fdd\u5b58 PDF \u94fe\u63a5",
    "openAttachments",
    "openVaultRoot",
    "openConfigFile",
    "id=\"vaultPath\"",
    "id=\"chooseVault\"",
    "id=\"selectionModifier\"",
    "id=\"selectionSaveMode\"",
    "id=\"selectionGestureEnabled\"",
    "id=\"saveConfig\""
  ]) {
    assert.doesNotMatch(popupHtml, new RegExp(removed));
  }

  assert.match(popupJs, /save-current-page/);
  assert.match(popupJs, /chrome\.runtime\.openOptionsPage/);
  assert.match(popupJs, /vaultState/);
  assert.match(popupJs, /gestureSummary/);
  assert.match(popupJs, /modeSummary/);
  assert.match(popupJs, /open-path/);
  assert.match(popupJs, /capture-viewport-screenshot/);
  assert.match(popupJs, /notifySaveResult/);
  assert.doesNotMatch(popupJs, /set-config/);
  assert.doesNotMatch(popupJs, /pick-folder/);
  assert.doesNotMatch(popupJs, /save-current-tab/);
  assert.doesNotMatch(popupJs, /save-pdf-link/);
  assert.match(background, /message\.type === "save-current-page"/);
  assert.match(background, /buildPageClip\(tab\)/);
  assert.match(background, /saveCapture\(capture\)/);
  assert.match(optionsHtml, /完整设置与诊断/);
  assert.match(optionsHtml, /Obsidian Vault 路径/);
  assert.match(optionsHtml, /快捷键与入口/);
  assert.match(optionsHtml, /浏览器内部页无法注入/);
  assert.match(optionsHtml, /当前视口截图不是滚动长截图/);
  assert.doesNotMatch(optionsHtml, /id="inboxDir"/);
  assert.doesNotMatch(optionsHtml, /id="attachmentsDir"/);
  assert.match(optionsJs, /selectionSaveMode/);
  assert.match(optionsJs, /hiddenConfig[.]inboxDir/);
  assert.match(optionsJs, /hiddenConfig[.]attachmentsDir/);
});

test("popup screenshot action dispatches before closing so page selection can start", async () => {
  const popupJs = await readFile(new URL("../extension/popup.js", import.meta.url), "utf8");
  const captureScreenshotBlock = popupJs.match(/async function captureScreenshot\(\) \{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(captureScreenshotBlock, /sendRuntimeMessage\(\{ type: "capture-screenshot" \}\)/);
  assert.match(captureScreenshotBlock, /window\.close\(\)/);
  assert.doesNotMatch(captureScreenshotBlock, /await sendAction\(\{ type: "capture-screenshot" \}/);
});

test("screenshot selection resolves on mouse release even when pointerup misses the overlay", async () => {
  const screenshot = await readFile(new URL("../extension/screenshot.js", import.meta.url), "utf8");

  assert.match(screenshot, /window\.addEventListener\("pointerup", onPointerUp, true\)/);
  assert.match(screenshot, /window\.addEventListener\("mouseup", onMouseUp, true\)/);
  assert.match(screenshot, /window\.addEventListener\("pointercancel", onPointerCancel, true\)/);
  assert.match(screenshot, /overlay\.releasePointerCapture\(activePointerId\)/);
  assert.match(screenshot, /let finished = false/);
  assert.match(screenshot, /if \(finished\) \{/);
});

test("host module structure separates request schema, downloads, rendering, filenames, diagnostics, and errors", async () => {
  for (const file of [
    "request-schema.ts",
    "image-downloader.ts",
    "markdown-renderer.ts",
    "filename.ts",
    "diagnostics.ts",
    "errors.ts"
  ]) {
    await readFile(new URL(`../src/host/${file}`, import.meta.url), "utf8");
  }

  const hostRequest = await readFile(new URL("../src/host/host-request.ts", import.meta.url), "utf8");
  const vaultWriter = await readFile(new URL("../src/host/vault-writer.ts", import.meta.url), "utf8");
  assert.match(hostRequest, /from "\.\/request-schema\.ts"/);
  assert.match(vaultWriter, /from "\.\/image-downloader\.ts"/);
  assert.match(vaultWriter, /from "\.\/filename\.ts"/);
  assert.match(vaultWriter, /from "\.\/markdown-renderer\.ts"/);
  assert.match(vaultWriter, /writePageCaptureToVault/);
});

test("gesture selection path reuses rich selection markdown before saving", async () => {
  const background = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");

  assert.match(background, /const selection = await getSelectionAsMarkdown\(sender\.tab\?\.id, text, config\.selectionSaveMode\)/);
  assert.match(background, /codeLanguage: typeof message\.codeLanguage === "string"[\s\S]*selection\.codeLanguage/);
  assert.doesNotMatch(background, /const markdown = normalizeSelectionText\(text\)/);
});

test("image downloader implementation documents timeout and size safety limits", async () => {
  const vaultWriter = await readFile(new URL("../src/host/image-downloader.ts", import.meta.url), "utf8");

  assert.match(vaultWriter, /IMAGE_DOWNLOAD_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(vaultWriter, /MAX_IMAGE_BYTES\s*=\s*20\s*\*\s*1024\s*\*\s*1024/);
  assert.match(vaultWriter, /AbortController/);
});

test("diagnostic scripts cover Windows and macOS install chains", async () => {
  const windowsScript = await readFile(new URL("../scripts/diagnose.ps1", import.meta.url), "utf8");
  const macScript = await readFile(new URL("../scripts/diagnose-macos.sh", import.meta.url), "utf8");

  for (const script of [windowsScript, macScript]) {
    assert.match(script, /Node/);
    assert.match(script, /manifest/i);
    assert.match(script, /allowed_origins/);
    assert.match(script, /config\.json/);
    assert.match(script, /vaultPath/);
    assert.match(script, /Inbox/);
    assert.match(script, /attachments/);
    assert.match(script, /Test write|test write|测试写入/);
    assert.match(script, /✅/);
    assert.match(script, /❌/);
  }

  assert.match(windowsScript, /ObsidianWebClipperLocal/);
  assert.match(windowsScript, /NativeMessagingHosts/);
  assert.match(macScript, /Google\/Chrome\/NativeMessagingHosts/);
  assert.match(macScript, /Microsoft Edge\/NativeMessagingHosts/);
  assert.match(macScript, /native-host/);
});

test("project metadata, CI, README, and changelog describe v0.2.5 capture formatting release", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const license = await readFile(new URL("../LICENSE", import.meta.url), "utf8");
  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const changelog = await readFile(new URL("../版本记录README.md", import.meta.url), "utf8");

  assert.equal(packageJson.version, "0.2.5");
  assert.equal(manifest.version, "0.2.5");
  assert.equal(manifest.background.type, "module");
  assert.match(license, /MIT License/);
  assert.match(ci, /windows-latest/);
  assert.match(ci, /macos-latest/);
  assert.match(ci, /node-version:[\s\S]*24\.x/);
  assert.match(ci, /node-version:[\s\S]*26\.x/);
  assert.match(ci, /npm test/);
  assert.match(ci, /npm run check/);
  assert.match(packageJson.scripts["release:zip"], /build-release/);
  assert.match(gitignore, /^dist\/$/m);
  assert.match(readme, /最新更新：v0\.2\.5/);
  assert.match(readme, /0\.2\.5/);
  assert.match(readme, /保存页面剪藏/);
  assert.match(readme, /单独 Markdown 文档/);
  assert.match(readme, /不再写入当天 Inbox 日记/);
  assert.match(readme, /同一天同一网址/);
  assert.match(readme, /### HH:mm 类型/);
  assert.match(readme, /不再追加原始图片 URL/);
  assert.match(readme, /scripts\/diagnose\.ps1/);
  assert.match(readme, /scripts\/diagnose-macos\.sh/);
  assert.match(readme, /常见问题/);
  assert.match(readme, /故障诊断/);
  assert.match(readme, /打开今天 Inbox/);
  assert.match(readme, /富 Markdown/);
  assert.match(readme, /release zip/);
  assert.match(changelog, /## v0\.2\.5 - 2026-05-07/);
  assert.match(changelog, /页面剪藏/);
  assert.match(changelog, /单独 Markdown 文档/);
  assert.match(changelog, /同日同 URL 聚合/);
  assert.match(changelog, /### HH:mm 类型/);
  assert.match(changelog, /不再追加原始图片来源 URL/);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

if (failed > 0) {
  process.exitCode = 1;
}
