import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { formatCaptureEntry } from "../src/host/markdown.ts";
import { handleHostRequest } from "../src/host/host-request.ts";
import { normalizeSelectionRect } from "../extension/screenshot-crop.js";
import { decodeNativeMessages, encodeNativeMessage } from "../src/host/native-protocol.ts";
import { buildAppendText, writeCaptureToVault } from "../src/host/vault-writer.ts";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

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

  assert.equal(entry, "- 06:31 [Article](https://example.com/a)\n\n```text\nfirst line\n  second line\n```\n");
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

test("formats screenshot data URL captures as only the embedded attachment", () => {
  const entry = formatCaptureEntry(
    {
      type: "image",
      title: "Screenshot Page",
      pageUrl: "https://example.com/page",
      imageUrl: "data:image/png;base64,AQID",
      capturedAt: "2026-04-29T06:34:00.000Z"
    },
    { attachmentName: "20260429-063400-screenshot.png" }
  );

  assert.equal(
    entry,
    "- 06:34 [Screenshot Page](https://example.com/page)\n  ![[20260429-063400-screenshot.png]]\n"
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

test("creates the daily inbox note when it does not exist", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));

  const result = await writeCaptureToVault(
    {
      type: "url",
      title: "Example",
      pageUrl: "https://example.com",
      capturedAt: "2026-04-29T08:00:00.000Z"
    },
    {
      vaultPath,
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments"
    }
  );

  assert.equal(result.notePath, path.join(vaultPath, "Inbox", "2026-04-29.md"));
  assert.equal(await readFile(result.notePath, "utf8"), "- 08:00 [Example](https://example.com)\n\n");
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
      capturedAt: "2026-04-29T08:00:00.000Z"
    },
    config
  );
  await writeCaptureToVault(
    {
      type: "selection",
      title: "Second",
      pageUrl: "https://example.com/2",
      text: "useful note",
      capturedAt: "2026-04-29T08:01:00.000Z"
    },
    config
  );

  const content = await readFile(path.join(vaultPath, "Inbox", "2026-04-29.md"), "utf8");
  assert.equal(
    content,
    "- 08:00 [First](https://example.com/1)\n\n- 08:01 [Second](https://example.com/2)\n\n```text\nuseful note\n```\n\n"
  );
});

test("closes an unclosed fenced code block before appending a new capture", () => {
  assert.equal(
    buildAppendText("manual paste\n```*\nnot closed", "- 08:05 [Shot](https://example.com)\n  ![[shot.png]]\n"),
    "\n\n```\n\n- 08:05 [Shot](https://example.com)\n  ![[shot.png]]\n\n"
  );
});

test("separates new captures from existing text that has no trailing newline", () => {
  assert.equal(
    buildAppendText("manual paste without newline", "- 08:06 [URL](https://example.com)\n"),
    "\n\n- 08:06 [URL](https://example.com)\n\n"
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
      capturedAt: "2026-04-29T08:04:00.000Z"
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
      capturedAt: "2026-04-29T08:02:00.000Z"
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

test("rejects inbox paths that escape the configured vault", async () => {
  const vaultPath = await mkdtemp(path.join(tmpdir(), "clipper-vault-"));

  await assert.rejects(
    () =>
      writeCaptureToVault(
        {
          type: "url",
          title: "Bad",
          pageUrl: "https://example.com",
          capturedAt: "2026-04-29T08:03:00.000Z"
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
  assert.deepEqual(await handleHostRequest({ type: "get-config" }, configPath), { ok: true, config });
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
