import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildUpdatedNoteContent, writeCaptureToVault } from "../src/host/vault-writer.ts";

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
  assert.equal(await readFile(result.notePath, "utf8"), "## [Example](https://example.com)\n来源：https://example.com\n\n- 08:00 保存链接\n\n");
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
    "## [First](https://example.com/1)\n来源：https://example.com/1\n\n- 08:00 保存链接\n\n## [Second](https://example.com/2)\n来源：https://example.com/2\n\n- 08:01 摘录\n\n```text\nuseful note\n```\n\n"
  );
});

test("groups same-day captures from the same page URL under one source heading", async () => {
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
      capturedAt: "2026-04-29T08:00:00.000Z"
    },
    config
  );
  await writeCaptureToVault(
    {
      type: "selection",
      title: "Renamed Tab",
      pageUrl: "https://example.com/docs",
      text: "same page excerpt",
      capturedAt: "2026-04-29T08:05:00.000Z"
    },
    config
  );

  const content = await readFile(path.join(vaultPath, "Inbox", "2026-04-29.md"), "utf8");
  assert.equal(
    content,
    "## [Example \\[Docs\\]](https://example.com/docs)\n来源：https://example.com/docs\n\n- 08:00 保存链接\n\n- 08:05 摘录\n\n```text\nsame page excerpt\n```\n\n"
  );
  assert.equal(content.match(/^## /gm)?.length, 1);
});

test("linkifies existing plain grouped headings before appending to the source group", () => {
  assert.equal(
    buildUpdatedNoteContent(
      "## Legacy \\[Docs\\]\n来源：https://example.com/docs\n\n- 08:00 保存链接\n\nmanual note\n",
      {
        type: "selection",
        title: "Renamed Tab",
        pageUrl: "https://example.com/docs",
        text: "same page excerpt",
        capturedAt: "2026-04-29T08:05:00.000Z"
      },
      "- 08:05 摘录\n\n```text\nsame page excerpt\n```\n"
    ),
    "## [Legacy \\[Docs\\]](https://example.com/docs)\n来源：https://example.com/docs\n\n- 08:00 保存链接\n\nmanual note\n\n- 08:05 摘录\n\n```text\nsame page excerpt\n```\n\n"
  );
});

test("migrates a legacy source link entry into the grouped source before appending", () => {
  assert.equal(
    buildUpdatedNoteContent(
      "- 08:00 [Legacy \\[Docs\\]](https://example.com/docs)\n\nmanual note\n",
      {
        type: "selection",
        title: "Renamed Tab",
        pageUrl: "https://example.com/docs",
        text: "same page excerpt",
        capturedAt: "2026-04-29T08:05:00.000Z"
      },
      "- 08:05 摘录\n\n```text\nsame page excerpt\n```\n"
    ),
    "## [Legacy \\[Docs\\]](https://example.com/docs)\n来源：https://example.com/docs\n\n- 08:00 保存链接\n\nmanual note\n\n- 08:05 摘录\n\n```text\nsame page excerpt\n```\n\n"
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
          capturedAt: `2026-04-29T08:0${index}:00.000Z`
        },
        config
      )
    )
  );

  const content = await readFile(path.join(vaultPath, "Inbox", "2026-04-29.md"), "utf8");
  for (let index = 0; index < 8; index += 1) {
    assert.match(content, new RegExp(`## \\[Page ${index}\\]\\(https://example\\.com/${index}\\)`));
    assert.match(content, new RegExp(`- 08:0${index} 保存链接`));
  }
});

test("keeps captures from the same URL on different UTC dates in separate daily notes", async () => {
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
      capturedAt: "2026-04-29T23:59:00.000Z"
    },
    config
  );
  await writeCaptureToVault(
    {
      type: "url",
      title: "Example",
      pageUrl: "https://example.com/docs",
      capturedAt: "2026-04-30T00:01:00.000Z"
    },
    config
  );

  assert.equal(
    await readFile(path.join(vaultPath, "Inbox", "2026-04-29.md"), "utf8"),
    "## [Example](https://example.com/docs)\n来源：https://example.com/docs\n\n- 23:59 保存链接\n\n"
  );
  assert.equal(
    await readFile(path.join(vaultPath, "Inbox", "2026-04-30.md"), "utf8"),
    "## [Example](https://example.com/docs)\n来源：https://example.com/docs\n\n- 00:01 保存链接\n\n"
  );
});

test("closes an unclosed manual fenced block before creating a new grouped source", () => {
  assert.equal(
    buildUpdatedNoteContent(
      "manual paste\n```*\nnot closed",
      {
        type: "url",
        title: "Example",
        pageUrl: "https://example.com",
        capturedAt: "2026-04-29T08:00:00.000Z"
      },
      "- 08:00 保存链接\n"
    ),
    "manual paste\n```*\nnot closed\n\n```\n\n## [Example](https://example.com)\n来源：https://example.com\n\n- 08:00 保存链接\n\n"
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
