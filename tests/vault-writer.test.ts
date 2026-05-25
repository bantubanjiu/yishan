import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildUpdatedNoteContent, writeCaptureToVault } from "../src/host/vault-writer.ts";

function localIso(year: number, month: number, day: number, hour: number, minute: number, second = 0): string {
  return new Date(year, month - 1, day, hour, minute, second).toISOString();
}

function localDatePath(vaultPath: string, year: number, month: number, day: number): string {
  return path.join(vaultPath, "Inbox", `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}.md`);
}

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
  assert.equal(await readFile(result.notePath, "utf8"), "#### [Example](https://example.com)\n\n- 08:00 保存链接\n\n");
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
    "#### [First](https://example.com/1)\n\n- 08:00 保存链接\n\n#### [Second](https://example.com/2)\n\n- 08:01 文字摘录\n\nuseful note\n\n"
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
    "#### [Example \\[Docs\\]](https://example.com/docs)\n\n- 08:00 保存链接\n\n- 08:05 文字摘录\n\nsame page excerpt\n\n"
  );
  assert.equal(content.match(/^#### /gm)?.length ?? 0, 1);
});

test("appends after legacy source-line grouped headings without rewriting previous content", () => {
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
      "- 08:05 文字摘录\n\nsame page excerpt\n"
    ),
    "## Legacy \\[Docs\\]\n来源：https://example.com/docs\n\n- 08:00 保存链接\n\nmanual note\n\n- 08:05 文字摘录\n\nsame page excerpt\n\n"
  );
});

test("inserts into a legacy source-line group before the next legacy group", () => {
  assert.equal(
    buildUpdatedNoteContent(
      "## First\n来源：https://example.com/first\n\n- 08:00 保存链接\n\n## Second\n来源：https://example.com/second\n\n- 08:01 保存链接\n",
      {
        type: "selection",
        title: "First",
        pageUrl: "https://example.com/first",
        text: "same page excerpt",
        capturedAt: localIso(2026, 4, 29, 8, 5)
      },
      "- 08:05 文字摘录\n\nsame page excerpt\n"
    ),
    "## First\n来源：https://example.com/first\n\n- 08:00 保存链接\n\n- 08:05 文字摘录\n\nsame page excerpt\n\n## Second\n来源：https://example.com/second\n\n- 08:01 保存链接\n"
  );
});

test("appends after existing level-four grouped headings without rewriting previous content", () => {
  assert.equal(
    buildUpdatedNoteContent(
      "#### [Legacy \\[Docs\\]](https://example.com/docs)\n\n- 08:00 保存链接\n\nmanual note\n",
      {
        type: "selection",
        title: "Renamed Tab",
        pageUrl: "https://example.com/docs",
        text: "same page excerpt",
        capturedAt: localIso(2026, 4, 29, 8, 5)
      },
      "- 08:05 文字摘录\n\nsame page excerpt\n"
    ),
    "#### [Legacy \\[Docs\\]](https://example.com/docs)\n\n- 08:00 保存链接\n\nmanual note\n\n- 08:05 文字摘录\n\nsame page excerpt\n\n"
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
      "- 08:05 文字摘录\n\nsame page excerpt\n"
    ),
    "- 08:00 [Legacy \\[Docs\\]](https://example.com/docs)\n\nmanual note\n\n#### [Renamed Tab](https://example.com/docs)\n\n- 08:05 文字摘录\n\nsame page excerpt\n\n"
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
    assert.match(content, new RegExp(`#### \\[Page ${index}\\]\\(https://example\\.com/${index}\\)\\n\\n- 08:0${index} 保存链接`));
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
    "#### [Example](https://example.com/docs)\n\n- 23:59 保存链接\n\n"
  );
  assert.equal(
    await readFile(localDatePath(vaultPath, 2026, 4, 30), "utf8"),
    "#### [Example](https://example.com/docs)\n\n- 00:01 保存链接\n\n"
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
      "- 08:00 保存链接\n"
    ),
    "manual paste\n```*\nnot closed\n\n```\n\n#### [Example](https://example.com)\n\n- 08:00 保存链接\n\n"
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
