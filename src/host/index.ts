#!/usr/bin/env node
import { stdin, stdout } from "node:process";

import { assertHostRequest, handleHostRequest } from "./host-request.ts";
import { decodeNativeMessages, encodeNativeMessage } from "./native-protocol.ts";
import type { HostResponse } from "./types.ts";

let stdoutBroken = false;
stdout.on("error", (error) => {
  if (isBrokenPipe(error)) {
    stdoutBroken = true;
    return;
  }
  throw error;
});

async function main(): Promise<void> {
  let buffer = Buffer.alloc(0);
  let queue = Promise.resolve();

  stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    queue = queue.then(processAvailableMessages).catch(writeUnexpectedError);
  });

  stdin.on("end", () => {
    queue = queue.then(async () => {
      if (buffer.length > 0) {
        await writeNativeResponse({ ok: false, error: "Incomplete native message frame" });
      }
    }).catch(writeUnexpectedError);
  });

  stdin.on("error", (error) => {
    queue = queue.then(() => writeUnexpectedError(error)).catch(writeUnexpectedError);
  });

  async function processAvailableMessages(): Promise<void> {
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      const frameLength = 4 + length;
      if (buffer.length < frameLength) {
        return;
      }

      const frame = buffer.subarray(0, frameLength);
      buffer = buffer.subarray(frameLength);
      const [rawMessage] = decodeNativeMessages(frame);
      await handleAndWriteResponse(rawMessage);
    }
  }
}

async function handleAndWriteResponse(rawMessage: unknown): Promise<void> {
  let response: HostResponse;
  try {
    response = (await handleHostRequest(assertHostRequest(rawMessage))) as HostResponse;
  } catch (error) {
    response = {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  await writeNativeResponse(response);
}

async function writeUnexpectedError(error: unknown): Promise<void> {
  await writeNativeResponse({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  });
}

function writeNativeResponse(response: HostResponse): Promise<void> {
  if (stdoutBroken) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    stdout.write(encodeNativeMessage(response), (error) => {
      if (isBrokenPipe(error) || stdoutBroken) {
        resolve();
        return;
      }
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function isBrokenPipe(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EPIPE";
}

main().catch(async (error) => {
  await writeNativeResponse({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  });
});
