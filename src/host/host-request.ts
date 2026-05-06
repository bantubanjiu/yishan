import { loadConfig, saveConfig } from "./config.ts";
import type { AppConfig, CaptureMessage, HostResponse } from "./types.ts";
import { writeCaptureToVault } from "./vault-writer.ts";

export type ConfigGetRequest = {
  type: "get-config";
};

export type ConfigSetRequest = {
  type: "set-config";
  config: AppConfig;
};

export type HostRequest = CaptureMessage | ConfigGetRequest | ConfigSetRequest;

export type ConfigGetResponse = {
  ok: true;
  config: AppConfig;
};

export type ConfigSetResponse = {
  ok: true;
};

export type HostRequestResponse = HostResponse | ConfigGetResponse | ConfigSetResponse;

export async function handleHostRequest(request: HostRequest, configPath?: string): Promise<HostRequestResponse> {
  if (request.type === "get-config") {
    return {
      ok: true,
      config: await loadConfig(configPath)
    };
  }

  if (request.type === "set-config") {
    await saveConfig(request.config, configPath);
    return { ok: true };
  }

  const config = await loadConfig(configPath);
  const result = await writeCaptureToVault(request, config);
  return {
    ok: true,
    notePath: result.notePath,
    attachmentName: result.attachmentName
  };
}

export function assertHostRequest(value: unknown): HostRequest {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Native message must be a request object");
  }

  if (
    value.type === "url" ||
    value.type === "selection" ||
    value.type === "image" ||
    value.type === "get-config" ||
    value.type === "set-config"
  ) {
    return value as HostRequest;
  }

  throw new Error(`Unsupported request type: ${value.type}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
