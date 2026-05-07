import { DEFAULT_SETTINGS } from "./constants.js";
import { sendNativeMessage } from "./native-client.js";
import { normalizeSelectionModifier } from "./utils.js";

export function normalizeConfigResponse(response) {
  if (!response?.ok) {
    return response;
  }
  return {
    ...response,
    config: normalizeConfig(response.config || {})
  };
}

export function normalizeConfig(config) {
  return {
    ...config,
    inboxDir: config.inboxDir || DEFAULT_SETTINGS.inboxDir,
    attachmentsDir: config.attachmentsDir || DEFAULT_SETTINGS.attachmentsDir,
    selectionModifier: normalizeSelectionModifier(config.selectionModifier || config.gestureModifier),
    selectionGestureEnabled: config.selectionGestureEnabled === true,
    selectionSaveMode: config.selectionSaveMode === "rich" ? "rich" : DEFAULT_SETTINGS.selectionSaveMode
  };
}

export async function loadGestureConfig() {
  try {
    const response = await sendNativeMessage({ type: "get-config" });
    return normalizeConfig(response?.config || {});
  } catch {
    return normalizeConfig({});
  }
}
