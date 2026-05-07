import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { loadConfig, saveConfig } from "./config.ts";
import type { AppConfig, CaptureMessage, HostResponse } from "./types.ts";
import { writeCaptureToVault } from "./vault-writer.ts";

const execFileAsync = promisify(execFile);
const MAX_TITLE_LENGTH = 300;
const PAGE_URL_PROTOCOLS = new Set(["http:", "https:", "file:"]);
const REMOTE_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif", ".bmp"]);
type ExecFileLike = (
  file: string,
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv;
    windowsHide?: boolean;
  }
) => Promise<{ stdout: string }>;

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
    const picker = deps.pickFolder ?? pickFolderForPlatform();
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

  if (value.type === "url") {
    return {
      type: "url",
      title: sanitizeTitle(value.title),
      pageUrl: validatePageUrl(value.pageUrl, "pageUrl"),
      capturedAt: validateIsoTimestamp(value.capturedAt)
    };
  }

  if (value.type === "selection") {
    return {
      type: "selection",
      title: sanitizeTitle(value.title),
      pageUrl: validatePageUrl(value.pageUrl, "pageUrl"),
      text: validateNonEmptyString(value.text, "text"),
      ...(typeof value.markdown === "string" ? { markdown: value.markdown } : {}),
      ...(typeof value.codeLanguage === "string" && value.codeLanguage.trim() ? { codeLanguage: value.codeLanguage.trim() } : {}),
      capturedAt: validateIsoTimestamp(value.capturedAt)
    };
  }

  if (value.type === "image") {
    return {
      type: "image",
      title: sanitizeTitle(value.title),
      pageUrl: validatePageUrl(value.pageUrl, "pageUrl"),
      imageUrl: validateImageUrl(value.imageUrl),
      capturedAt: validateIsoTimestamp(value.capturedAt)
    };
  }

  if (value.type === "get-config") {
    return { type: "get-config" };
  }

  if (value.type === "set-config") {
    return {
      type: "set-config",
      config: sanitizeConfig(value.config)
    };
  }

  if (value.type === "pick-folder") {
    return {
      type: "pick-folder",
      ...(typeof value.initialPath === "string" && value.initialPath.trim() ? { initialPath: value.initialPath.trim() } : {})
    };
  }

  throw new Error(`Unsupported request type: ${value.type}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeTitle(value: unknown): string {
  if (typeof value !== "string") {
    return "Untitled";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "Untitled";
  }
  return trimmed.slice(0, MAX_TITLE_LENGTH);
}

function validateNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function validateIsoTimestamp(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("capturedAt must be an ISO timestamp string");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("capturedAt must be a valid ISO timestamp");
  }
  return value;
}

function validatePageUrl(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty URL`);
  }

  try {
    const url = new URL(value);
    if (!PAGE_URL_PROTOCOLS.has(url.protocol)) {
      throw new Error(`${field} must use http, https, or file protocol`);
    }
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(field)) {
      throw error;
    }
    throw new Error(`${field} must be a valid URL`);
  }
}

function validateImageUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("imageUrl must be a non-empty image URL");
  }

  if (value.startsWith("data:")) {
    if (!/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(value)) {
      throw new Error("imageUrl must be an image data URL");
    }
    return value;
  }

  try {
    const url = new URL(value);
    if (!["http:", "https:", "file:"].includes(url.protocol)) {
      throw new Error("imageUrl must use http, https, file, or image data protocol");
    }
    const ext = path.extname(url.pathname).toLowerCase();
    if (url.protocol !== "file:" && ext && !REMOTE_IMAGE_EXTENSIONS.has(ext)) {
      throw new Error("imageUrl must point to a supported image extension or omit the extension");
    }
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("imageUrl")) {
      throw error;
    }
    throw new Error("imageUrl must be a valid URL");
  }
}

function sanitizeConfig(value: unknown): AppConfig {
  if (!isRecord(value)) {
    throw new Error("config must be a JSON object");
  }

  const config = {
    vaultPath: validateConfigString(value.vaultPath, "config.vaultPath"),
    inboxDir: validateConfigString(value.inboxDir, "config.inboxDir"),
    attachmentsDir: validateConfigString(value.attachmentsDir, "config.attachmentsDir"),
    ...(typeof value.selectionModifier === "string" && value.selectionModifier.trim()
      ? { selectionModifier: value.selectionModifier.trim() }
      : {}),
    ...(typeof value.selectionGestureEnabled === "boolean" ? { selectionGestureEnabled: value.selectionGestureEnabled } : {})
  };

  if ("selectionModifier" in value && typeof value.selectionModifier !== "string") {
    throw new Error("config.selectionModifier must be a string");
  }
  if ("selectionGestureEnabled" in value && typeof value.selectionGestureEnabled !== "boolean") {
    throw new Error("config.selectionGestureEnabled must be a boolean");
  }

  return config;
}

function validateConfigString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
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

export function pickFolderForPlatform(platform = process.platform): (initialPath?: string) => Promise<string | undefined> {
  if (platform === "darwin") {
    return pickFolderWithAppleScript;
  }
  if (platform === "win32") {
    return pickFolderWithPowerShell;
  }
  return pickFolderWithConsoleFallback;
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
