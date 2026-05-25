export type CaptureMessage =
  | {
      type: "url";
      title: string;
      pageUrl: string;
      capturedAt: string;
    }
  | {
      type: "page";
      title: string;
      pageUrl: string;
      markdown: string;
      images?: Array<{
        url: string;
        alt?: string;
      }>;
      capturedAt: string;
    }
  | {
      type: "selection";
      title: string;
      pageUrl: string;
      text: string;
      markdown?: string;
      codeLanguage?: string;
      capturedAt: string;
    }
  | {
      type: "image";
      title: string;
      pageUrl: string;
      imageUrl: string;
      capturedAt: string;
    };

export type BatchSaveTabsRequest = {
  type: "batch-save-tabs";
  tabs: Extract<CaptureMessage, { type: "url" }>[];
};

export type AppConfig = {
  vaultPath: string;
  inboxDir: string;
  attachmentsDir: string;
  selectionModifier?: string;
  selectionGestureEnabled?: boolean;
  selectionSaveMode?: "plain" | "rich";
};

export type HostResponse =
  | {
      ok: true;
      notePath: string;
      attachmentName?: string;
      attachments?: string[];
      imageFailures?: string[];
    }
  | {
      ok: true;
      path: string;
    }
  | {
      ok: true;
      saved: number;
      failed: number;
      failures: Array<{
        title: string;
        pageUrl: string;
        error: string;
      }>;
    }
  | {
      ok: true;
      config: AppConfig;
    }
  | {
      ok: false;
      error: string;
    };
