// WP2A — Google Picker folder-selection lifecycle (browser only).
//
// Scope: My Drive folders OWNED BY the connected Google account.
// Shared-with-me and Shared Drive folders are intentionally excluded; the
// Picker must be a single instance, must be hidden on every terminal path,
// and the short-lived access token must never outlive the session.

export const PICKER_ACCOUNT_GUIDANCE =
  "The Google Picker uses the account your browser is currently signed in to. Make sure that is the connected account below before selecting a folder.";

export interface PickerData {
  action: string;
  docs?: { id?: string }[];
}

export interface PickerInstance {
  setVisible: (v: boolean) => void;
}

export interface PickerBuilder {
  setOAuthToken: (t: string) => PickerBuilder;
  setDeveloperKey: (k: string) => PickerBuilder;
  setOrigin: (o: string) => PickerBuilder;
  addView: (v: unknown) => PickerBuilder;
  setCallback: (cb: (data: PickerData) => void) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  build: () => PickerInstance;
}

export interface DocsViewInstance {
  setIncludeFolders: (v: boolean) => DocsViewInstance;
  setSelectFolderEnabled: (v: boolean) => DocsViewInstance;
  setOwnedByMe: (v: boolean) => DocsViewInstance;
  setMimeTypes: (v: string) => DocsViewInstance;
}

export interface GoogleNamespace {
  picker?: {
    DocsView: new (viewId: unknown) => DocsViewInstance;
    ViewId: { FOLDERS: unknown };
    PickerBuilder: new () => PickerBuilder;
  };
}

export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export interface OpenFolderPickerOptions {
  google: GoogleNamespace;
  accessToken: string;
  apiKey: string;
  appId?: string | null;
  origin: string;
  onPicked: (folderId: string) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Build and show a single folders-only Picker restricted to folders owned by
 * the connected account. The instance is hidden before `onPicked`/`onCancel`
 * run, so control always returns to ServiceHub first.
 */
export function openFolderPicker(options: OpenFolderPickerOptions): PickerInstance {
  const p = options.google.picker;
  if (!p) throw new Error("Google Picker could not be loaded.");

  const view = new p.DocsView(p.ViewId.FOLDERS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(true)
    .setOwnedByMe(true)
    .setMimeTypes(FOLDER_MIME_TYPE);

  let instance: PickerInstance | null = null;
  const hide = () => {
    try {
      instance?.setVisible(false);
    } catch {
      /* ignore */
    }
  };

  const builder = new p.PickerBuilder()
    .setOAuthToken(options.accessToken)
    .setDeveloperKey(options.apiKey)
    .setOrigin(options.origin)
    .addView(view)
    .setCallback((data: PickerData) => {
      if (data.action === "picked") {
        const folderId = data.docs?.[0]?.id;
        hide();
        if (folderId) void options.onPicked(folderId);
        else options.onCancel();
        return;
      }
      if (data.action === "cancel") {
        hide();
        options.onCancel();
      }
    });

  if (options.appId) builder.setAppId(options.appId);

  instance = builder.build();
  instance.setVisible(true);
  return instance;
}

export function loadGoogleApi(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as {
      gapi?: { load: (m: string, cb: () => void) => void };
    };
    const start = () => w.gapi!.load("picker", () => resolve());
    if (w.gapi) return start();
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.onload = start;
    script.onerror = () => reject(new Error("Could not load the Google Picker script."));
    document.head.appendChild(script);
  });
}
