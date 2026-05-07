import { HOST_NAME } from "./constants.js";

export function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

export async function saveCapture(capture) {
  const response = await sendNativeMessage(capture);
  if (!response?.ok) {
    throw new Error(response?.error || "Unknown native host error");
  }
  return response;
}
