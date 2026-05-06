export type CaptureMessage =
  | {
      type: "url";
      title: string;
      pageUrl: string;
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

export type AppConfig = {
  vaultPath: string;
  inboxDir: string;
  attachmentsDir: string;
};

export type HostResponse =
  | {
      ok: true;
      notePath: string;
      attachmentName?: string;
    }
  | {
      ok: false;
      error: string;
    };
