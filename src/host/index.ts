#!/usr/bin/env node
import { stdin, stdout } from "node:process";

import { assertHostRequest, handleHostRequest } from "./host-request.ts";
import { decodeNativeMessages, encodeNativeMessage } from "./native-protocol.ts";
import type { HostResponse } from "./types.ts";

async function main(): Promise<void> {
  const input = await readAllStdin();

  for (const rawMessage of decodeNativeMessages(input)) {
    let response: HostResponse;
    try {
      response = (await handleHostRequest(assertHostRequest(rawMessage))) as HostResponse;
    } catch (error) {
      response = {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    stdout.write(encodeNativeMessage(response));
  }
}

function readAllStdin(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stdin.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stdin.on("error", reject);
    stdin.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

main().catch((error) => {
  stdout.write(
    encodeNativeMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  );
});
