import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { AppConfig } from "./types.ts";

const APP_DIR = path.join(homedir(), ".obsidian-web-clipper-local");
export const DEFAULT_CONFIG_PATH = path.join(APP_DIR, "config.json");
export const DEFAULT_INBOX_DIR = "Inbox";
export const DEFAULT_ATTACHMENTS_DIR = "Inbox/attachments";
export const DEFAULT_SELECTION_MODIFIER = "Alt";
export const DEFAULT_SELECTION_GESTURE_ENABLED = false;
export const DEFAULT_SELECTION_SAVE_MODE = "plain";

export const EMPTY_CONFIG: AppConfig = {
  vaultPath: "",
  inboxDir: DEFAULT_INBOX_DIR,
  attachmentsDir: DEFAULT_ATTACHMENTS_DIR,
  selectionModifier: DEFAULT_SELECTION_MODIFIER,
  selectionGestureEnabled: DEFAULT_SELECTION_GESTURE_ENABLED,
  selectionSaveMode: DEFAULT_SELECTION_SAVE_MODE
};

export async function loadConfig(
  configPath = DEFAULT_CONFIG_PATH,
  options: { allowMissing?: boolean } = {}
): Promise<AppConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (options.allowMissing && isFileNotFound(error)) {
      return { ...EMPTY_CONFIG };
    }
    throw error;
  }
  const parsed = JSON.parse(raw);
  validateConfig(parsed);
  return withConfigDefaults(parsed);
}

export async function saveConfig(config: AppConfig, configPath = DEFAULT_CONFIG_PATH): Promise<void> {
  validateConfig(config);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(withConfigDefaults(config), null, 2)}\n`, "utf8");
}

export function validateConfig(value: unknown): asserts value is AppConfig {
  if (!isRecord(value)) {
    throw new Error("Config must be a JSON object");
  }
  for (const key of ["vaultPath", "inboxDir", "attachmentsDir"] as const) {
    if (typeof value[key] !== "string" || value[key].trim() === "") {
      throw new Error(`Config field ${key} must be a non-empty string`);
    }
  }
  if (
    "selectionModifier" in value &&
    (typeof value.selectionModifier !== "string" || value.selectionModifier.trim() === "")
  ) {
    throw new Error("Config field selectionModifier must be a non-empty string");
  }
  if ("selectionGestureEnabled" in value && typeof value.selectionGestureEnabled !== "boolean") {
    throw new Error("Config field selectionGestureEnabled must be a boolean");
  }
  if (
    "selectionSaveMode" in value &&
    value.selectionSaveMode !== undefined &&
    value.selectionSaveMode !== "plain" &&
    value.selectionSaveMode !== "rich"
  ) {
    throw new Error("Config field selectionSaveMode must be plain or rich");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function withConfigDefaults(config: AppConfig): AppConfig {
  return {
    ...config,
    selectionModifier: config.selectionModifier ?? DEFAULT_SELECTION_MODIFIER,
    selectionGestureEnabled: config.selectionGestureEnabled ?? DEFAULT_SELECTION_GESTURE_ENABLED,
    selectionSaveMode: config.selectionSaveMode ?? DEFAULT_SELECTION_SAVE_MODE
  };
}
