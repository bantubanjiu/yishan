import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { AppConfig } from "./types.ts";

const APP_DIR = path.join(homedir(), ".obsidian-web-clipper-local");
export const DEFAULT_CONFIG_PATH = path.join(APP_DIR, "config.json");
export const DEFAULT_SELECTION_MODIFIER = "Alt";
export const DEFAULT_SELECTION_GESTURE_ENABLED = false;

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH): Promise<AppConfig> {
  const raw = await readFile(configPath, "utf8");
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withConfigDefaults(config: AppConfig): AppConfig {
  return {
    ...config,
    selectionModifier: config.selectionModifier ?? DEFAULT_SELECTION_MODIFIER,
    selectionGestureEnabled: config.selectionGestureEnabled ?? DEFAULT_SELECTION_GESTURE_ENABLED
  };
}
