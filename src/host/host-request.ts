import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { DEFAULT_CONFIG_PATH, loadConfig, saveConfig } from "./config.ts";
import { errorMessage } from "./errors.ts";
import { formatDate } from "./filename.ts";
import {
  assertHostRequest,
  type ConfigGetRequest,
  type ConfigSetRequest,
  type HostRequest,
  type OpenPathRequest,
  type PickFolderRequest
} from "./request-schema.ts";
import type { AppConfig, HostResponse } from "./types.ts";
import { writeCaptureToVault } from "./vault-writer.ts";

export { assertHostRequest };
export type { ConfigGetRequest, ConfigSetRequest, HostRequest, OpenPathRequest, PickFolderRequest };

const execFileAsync = promisify(execFile);

type ExecFileLike = (
  file: string,
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv;
    windowsHide?: boolean;
  }
) => Promise<{ stdout: string }>;

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

export type BatchSaveTabsResponse = Extract<HostResponse, { saved: number }>;

export type OpenPathResponse = {
  ok: true;
  path: string;
};

export type HostRequestResponse =
  | HostResponse
  | ConfigGetResponse
  | ConfigSetResponse
  | PickFolderResponse
  | BatchSaveTabsResponse
  | OpenPathResponse;

export type HostRequestDeps = {
  pickFolder?: (initialPath?: string) => Promise<string | undefined>;
  openPath?: (targetPath: string) => Promise<void>;
};

export async function handleHostRequest(
  request: HostRequest,
  configPath?: string,
  deps: HostRequestDeps = {}
): Promise<HostRequestResponse> {
  if (request.type === "get-config") {
    return {
      ok: true,
      config: await loadConfig(configPath, { allowMissing: true })
    };
  }

  if (request.type === "set-config") {
    await saveConfig(request.config, configPath);
    return { ok: true };
  }

  if (request.type === "pick-folder") {
    const picker = deps.pickFolder ?? pickFolderForPlatform();
    const selectedPath = await picker(request.initialPath);
    if (!selectedPath) {
      return { ok: false, error: "用户取消选择文件夹" };
    }
    return { ok: true, path: selectedPath };
  }

  if (request.type === "open-path") {
    const targetPath = await resolveOpenPathTarget(request.target, configPath);
    const openPath = deps.openPath ?? openPathForPlatform();
    await openPath(toObsidianOpenUri(targetPath));
    return { ok: true, path: targetPath };
  }

  const config = await loadConfig(configPath);

  if (request.type === "batch-save-tabs") {
    const failures: Array<{
      title: string;
      pageUrl: string;
      error: string;
    }> = [];
    let saved = 0;
    for (const tab of request.tabs) {
      try {
        await writeCaptureToVault(tab, config);
        saved += 1;
      } catch (error) {
        failures.push({
          title: tab.title || "Untitled",
          pageUrl: tab.pageUrl || "",
          error: errorMessage(error)
        });
      }
    }

    return {
      ok: true,
      saved,
      failed: failures.length,
      failures
    };
  }

  const result = await writeCaptureToVault(request, config);
  return {
    ok: true,
    notePath: result.notePath,
    attachmentName: result.attachmentName,
    attachments: result.attachments
  };
}

async function resolveOpenPathTarget(target: OpenPathRequest["target"], configPath = DEFAULT_CONFIG_PATH): Promise<string> {
  if (target !== "today-inbox") {
    throw new Error("open-path target must be today-inbox");
  }

  const config = await loadConfig(configPath);
  const vaultPath = path.resolve(config.vaultPath);
  const relativePath = path.join(config.inboxDir, `${formatDate(new Date().toISOString())}.md`);
  const resolved = resolveInsideVault(vaultPath, relativePath, "Open path target");

  await assertPathExists(resolved);

  return resolved;
}

function toObsidianOpenUri(notePath: string): string {
  return `obsidian://open?path=${encodeURIComponent(notePath)}`;
}

async function assertPathExists(targetPath: string): Promise<void> {
  try {
    await access(targetPath);
  } catch {
    throw new Error(`路径不存在：${targetPath}`);
  }
}

function resolveInsideVault(vaultPath: string, relativePath: string, label: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a relative path inside the vault`);
  }

  const resolved = path.resolve(vaultPath, relativePath);
  const relative = path.relative(vaultPath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the vault`);
  }
  return resolved;
}

export function pickFolderForPlatform(platform = process.platform): (initialPath?: string) => Promise<string | undefined> {
  if (platform === "darwin") {
    return pickFolderWithAppleScript;
  }
  if (platform === "win32") {
    return pickFolderWithPowerShell;
  }
  return pickFolderWithConsoleFallback;
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

export async function pickFolderWithAppleScript(
  initialPath?: string,
  execFileImpl: ExecFileLike = execFileAsync
): Promise<string | undefined> {
  const script = `
set initialPath to system attribute "OBSIDIAN_CLIPPER_INITIAL_PATH"
if initialPath is not "" then
  try
    set initialFolder to POSIX file initialPath as alias
    set selectedFolder to choose folder with prompt "选择 Obsidian 仓库文件夹" default location initialFolder
  on error
    set selectedFolder to choose folder with prompt "选择 Obsidian 仓库文件夹"
  end try
else
  set selectedFolder to choose folder with prompt "选择 Obsidian 仓库文件夹"
end if
POSIX path of selectedFolder
`;
  const { stdout } = await execFileImpl("osascript", ["-e", script], {
    env: {
      ...process.env,
      OBSIDIAN_CLIPPER_INITIAL_PATH: initialPath ?? ""
    }
  });
  const selectedPath = stdout.trim();
  return selectedPath || undefined;
}

async function pickFolderWithConsoleFallback(): Promise<string | undefined> {
  throw new Error(`Folder picker is not supported on ${process.platform}. Please enter the Vault path manually.`);
}

function openPathForPlatform(platform = process.platform): (targetPath: string) => Promise<void> {
  if (platform === "darwin") {
    return async (targetPath) => {
      await execFileAsync("open", [targetPath]);
    };
  }
  if (platform === "win32") {
    return async (targetPath) => {
      await execFileAsync("rundll32.exe", ["url.dll,FileProtocolHandler", targetPath], { windowsHide: true });
    };
  }
  return async (targetPath) => {
    await execFileAsync("xdg-open", [targetPath]);
  };
}
