import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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

function localTime(isoDate) {
  const date = new Date(isoDate);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function expectAnyString(value) {
  assert.equal(typeof value, "string");
  return value;
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

  assert.equal(entry, "- 06:31 [Article](https://example.com/a)\n\n```text\nfirst line\n  second line\n```\n");
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
      capturedAt: localIso(2026, 4, 29, 6, 33)
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
      capturedAt: localIso(2026, 4, 29, 8, 0)
    },
    {
      vaultPath,
      inboxDir: "Inbox",
      attachmentsDir: "Inbox/attachments"
    }
  );

  assert.equal(result.notePath, localDatePath(vaultPath, 2026, 4, 29));
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
    "- 08:00 [First](https://example.com/1)\n\n- 08:01 [Second](https://example.com/2)\n\n```text\nuseful note\n```\n\n"
  );
});

test("appends same-day captures from the same page URL as timestamped source links", async () => {
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
    "- 08:00 [Example \\[Docs\\]](https://example.com/docs)\n\n- 08:05 [Renamed Tab](https://example.com/docs)\n\n```text\nsame page excerpt\n```\n\n"
  );
  assert.equal(content.match(/^## /gm)?.length ?? 0, 0);
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
      "- 08:05 [Renamed Tab](https://example.com/docs)\n\n```text\nsame page excerpt\n```\n"
    ),
    "## Legacy \\[Docs\\]\n来源：https://example.com/docs\n\n- 08:00 保存链接\n\nmanual note\n\n- 08:05 [Renamed Tab](https://example.com/docs)\n\n```text\nsame page excerpt\n```\n\n"
  );
});

test("keeps legacy source link entries and appends the next timestamped source link", () => {
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
      "- 08:05 [Renamed Tab](https://example.com/docs)\n\n```text\nsame page excerpt\n```\n"
    ),
    "- 08:00 [Legacy \\[Docs\\]](https://example.com/docs)\n\nmanual note\n\n- 08:05 [Renamed Tab](https://example.com/docs)\n\n```text\nsame page excerpt\n```\n\n"
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
    assert.match(content, new RegExp(`- 08:0${index} \\[Page ${index}\\]\\(https://example\\.com/${index}\\)`));
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
    "- 23:59 [Example](https://example.com/docs)\n\n"
  );
  assert.equal(
    await readFile(localDatePath(vaultPath, 2026, 4, 30), "utf8"),
    "- 00:01 [Example](https://example.com/docs)\n\n"
  );
});

test("closes an unclosed fenced code block before appending a new capture", () => {
  assert.equal(
    buildAppendText("manual paste\n```*\nnot closed", "- 08:05 [Shot](https://example.com)\n  ![[shot.png]]\n"),
    "\n\n```\n\n- 08:05 [Shot](https://example.com)\n  ![[shot.png]]\n\n"
  );
});

test("closes an unclosed manual fenced block before appending a new source link", () => {
  assert.equal(
    buildUpdatedNoteContent(
      "manual paste\n```*\nnot closed",
      {
        type: "url",
        title: "Example",
        pageUrl: "https://example.com",
        capturedAt: localIso(2026, 4, 29, 8, 0)
      },
      "- 08:00 [Example](https://example.com)\n"
    ),
    "manual paste\n```*\nnot closed\n\n```\n\n- 08:00 [Example](https://example.com)\n\n"
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
    selectionGestureEnabled: false
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
    config: { ...config, selectionModifier: "Alt", selectionGestureEnabled: false }
  });
});

test("accepts pick-folder native requests", () => {
  assert.deepEqual(assertHostRequest({ type: "pick-folder", initialPath: "C:\\Vault" }), {
    type: "pick-folder",
    initialPath: "C:\\Vault"
  });
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

test("extension background gates gesture injection behind explicit enablement and active-tab sync", async () => {
  const background = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");

  assert.match(background, /selectionModifier:\s*"Alt"/);
  assert.match(background, /selectionGestureEnabled:\s*false/);
  assert.match(background, /normalizeSelectionModifier\(config\.selectionModifier \|\| config\.gestureModifier\)/);
  assert.match(background, /modifier:\s*gestureConfig\.selectionModifier/);
  assert.match(background, /syncSelectionGestureForActiveTab/);
  assert.doesNotMatch(background, /tabs\.onActivated/);
  assert.doesNotMatch(background, /tabs\.onUpdated/);
  assert.doesNotMatch(background, /modifier:\s*DEFAULT_SETTINGS\.gestureModifier/);
});

test("gesture selection path reuses rich selection markdown before saving", async () => {
  const background = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");

  assert.match(background, /const selection = await getSelectionAsMarkdown\(sender\.tab\?\.id, text\)/);
  assert.match(background, /codeLanguage: typeof message\.codeLanguage === "string"[\s\S]*selection\.codeLanguage/);
  assert.doesNotMatch(background, /const markdown = normalizeSelectionText\(text\)/);
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
