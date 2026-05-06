import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { loadConfig, saveConfig } from "./config.ts";
import type { AppConfig, CaptureMessage, HostResponse } from "./types.ts";
import { writeCaptureToVault } from "./vault-writer.ts";

const execFileAsync = promisify(execFile);

export type ConfigGetRequest = {
  type: "get-config";
};

export type ConfigSetRequest = {
  type: "set-config";
  config: AppConfig;
};

export type PickFolderRequest = {
  type: "pick-folder";
  initialPath?: string;
};

export type HostRequest = CaptureMessage | ConfigGetRequest | ConfigSetRequest | PickFolderRequest;

export type ConfigGetResponse = {
  ok: true;
  config: AppConfig;
};

export type ConfigSetResponse = {
  ok: true;
};

export type PickFolderResponse =
  | {
      ok: true;
      path: string;
    }
  | {
      ok: false;
      error: "用户取消选择文件夹";
    };

export type HostRequestResponse = HostResponse | ConfigGetResponse | ConfigSetResponse | PickFolderResponse;

export type HostRequestDeps = {
  pickFolder?: (initialPath?: string) => Promise<string | undefined>;
};

export async function handleHostRequest(
  request: HostRequest,
  configPath?: string,
  deps: HostRequestDeps = {}
): Promise<HostRequestResponse> {
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

  if (request.type === "pick-folder") {
    const picker = deps.pickFolder ?? pickFolderWithPowerShell;
    const selectedPath = await picker(request.initialPath);
    if (!selectedPath) {
      return { ok: false, error: "用户取消选择文件夹" };
    }
    return { ok: true, path: selectedPath };
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
    value.type === "set-config" ||
    value.type === "pick-folder"
  ) {
    return value as HostRequest;
  }

  throw new Error(`Unsupported request type: ${value.type}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function pickFolderWithPowerShell(initialPath?: string): Promise<string | undefined> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择 Obsidian 仓库文件夹'
$dialog.ShowNewFolderButton = $true
$initialPath = $env:OBSIDIAN_CLIPPER_INITIAL_PATH
if (-not [string]::IsNullOrWhiteSpace($initialPath) -and [System.IO.Directory]::Exists($initialPath)) {
  $dialog.SelectedPath = $initialPath
}
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
`;

  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    env: {
      ...process.env,
      OBSIDIAN_CLIPPER_INITIAL_PATH: initialPath ?? ""
    },
    windowsHide: true
  });
  const selectedPath = stdout.trim();
  return selectedPath || undefined;
}
