export const IMAGE_DOWNLOAD_TIMEOUT_MS = 10_000;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type FetchBinaryResult = {
  bytes: Uint8Array;
  contentType?: string;
};

export async function defaultFetchBinary(url: string): Promise<FetchBinaryResult> {
  if (url.startsWith("data:")) {
    return decodeDataUrl(url);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    if (!isImageContentType(contentType)) {
      throw new Error("响应不是图片内容");
    }

    const contentLength = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new Error("图片体积超过 20MB");
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("图片体积超过 20MB");
    }

    return { bytes, contentType };
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("图片下载超时");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function validateDownloadedImage(downloaded: FetchBinaryResult): void {
  if (!isImageContentType(downloaded.contentType)) {
    throw new Error("响应不是图片内容");
  }
  if (downloaded.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("图片体积超过 20MB");
  }
}

function decodeDataUrl(url: string): FetchBinaryResult {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!match) {
    throw new Error("Invalid data URL");
  }

  const [, contentType, base64Flag, payload] = match;
  if (!isImageContentType(contentType)) {
    throw new Error("Invalid data URL");
  }
  const bytes = base64Flag
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("图片体积超过 20MB");
  }

  return { bytes, contentType };
}

function isImageContentType(contentType?: string): boolean {
  return typeof contentType === "string" && contentType.split(";")[0].trim().toLowerCase().startsWith("image/");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
