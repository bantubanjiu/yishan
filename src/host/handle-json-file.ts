#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { assertHostRequest, handleHostRequest } from "./host-request.ts";
import type { HostResponse } from "./types.ts";

const [payloadPath] = process.argv.slice(2);

if (!payloadPath) {
  console.log(JSON.stringify({ ok: false, error: "Missing payload path" } satisfies HostResponse));
  process.exit(1);
}

try {
  const message = assertHostRequest(JSON.parse(await readFile(payloadPath, "utf8")));
  console.log(JSON.stringify(await handleHostRequest(message)));
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    } satisfies HostResponse)
  );
}
