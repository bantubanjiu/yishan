import path from "node:path";

import type { AppConfig, BatchSaveTabsRequest, CaptureMessage } from "./types.ts";

const MAX_TITLE_LENGTH = 300;
const PAGE_URL_PROTOCOLS = new Set(["http:", "https:", "file:"]);
const REMOTE_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif", ".bmp"]);
const OPEN_PATH_TARGETS = new Set(["today-inbox", "attachments", "vault", "config"]);

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

export type OpenPathRequest = {
  type: "open-path";
  target: "today-inbox" | "attachments" | "vault" | "config";
};

export type HostRequest =
  | CaptureMessage
  | ConfigGetRequest
  | ConfigSetRequest
  | PickFolderRequest
  | BatchSaveTabsRequest
  | OpenPathRequest;

export function assertHostRequest(value: unknown): HostRequest {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Native message must be a request object");
  }

  if (value.type === "url") {
    return sanitizeUrlCapture(value);
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

  if (value.type === "batch-save-tabs") {
    if (!Array.isArray(value.tabs)) {
      throw new Error("batch-save-tabs tabs must be an array");
    }
    return {
      type: "batch-save-tabs",
      tabs: value.tabs.map((tab, index) => {
        if (!isRecord(tab)) {
          throw new Error(`batch-save-tabs tabs[${index}] must be an object`);
        }
        return sanitizeUrlCapture({ ...tab, type: "url" });
      })
    };
  }

  if (value.type === "open-path") {
    if (typeof value.target !== "string" || !OPEN_PATH_TARGETS.has(value.target)) {
      throw new Error("open-path target must be today-inbox, attachments, vault, or config");
    }
    return { type: "open-path", target: value.target as OpenPathRequest["target"] };
  }

  throw new Error(`Unsupported request type: ${value.type}`);
}

function sanitizeUrlCapture(value: Record<string, unknown>): Extract<CaptureMessage, { type: "url" }> {
  return {
    type: "url",
    title: sanitizeTitle(value.title),
    pageUrl: validatePageUrl(value.pageUrl, "pageUrl"),
    capturedAt: validateIsoTimestamp(value.capturedAt)
  };
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
    ...(typeof value.selectionGestureEnabled === "boolean" ? { selectionGestureEnabled: value.selectionGestureEnabled } : {}),
    ...(value.selectionSaveMode === "plain" || value.selectionSaveMode === "rich" ? { selectionSaveMode: value.selectionSaveMode } : {})
  };

  if ("selectionModifier" in value && typeof value.selectionModifier !== "string") {
    throw new Error("config.selectionModifier must be a string");
  }
  if ("selectionGestureEnabled" in value && typeof value.selectionGestureEnabled !== "boolean") {
    throw new Error("config.selectionGestureEnabled must be a boolean");
  }
  if (
    "selectionSaveMode" in value &&
    value.selectionSaveMode !== undefined &&
    value.selectionSaveMode !== "plain" &&
    value.selectionSaveMode !== "rich"
  ) {
    throw new Error("config.selectionSaveMode must be plain or rich");
  }

  return config;
}

function validateConfigString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}
