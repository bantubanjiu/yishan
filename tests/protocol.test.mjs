import assert from "node:assert/strict";
import test from "node:test";

import { decodeNativeMessages, encodeNativeMessage } from "../src/host/native-protocol.ts";

test("encodes native messaging JSON with a 4-byte little-endian length prefix", () => {
  const encoded = encodeNativeMessage({ ok: true, notePath: "Inbox/2026-04-29.md" });

  assert.equal(encoded.readUInt32LE(0), encoded.length - 4);
  assert.equal(encoded.subarray(4).toString("utf8"), '{"ok":true,"notePath":"Inbox/2026-04-29.md"}');
});

test("decodes one or more native messaging frames", () => {
  const first = encodeNativeMessage({ type: "url", title: "A", pageUrl: "https://a.test", capturedAt: "2026-04-29T00:00:00.000Z" });
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
