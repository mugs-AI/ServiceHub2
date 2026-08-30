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
 * run, so control always returns to ServiceHub first. A terminal latch makes
 * the first picked/cancel event the only one that has any effect.
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
  let terminal = false;
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
      if (data.action !== "picked" && data.action !== "cancel") return;
      if (terminal) return; // exactly-once terminal latch
      terminal = true;
      const folderId = data.action === "picked" ? data.docs?.[0]?.id : undefined;
      hide();
      if (folderId) void options.onPicked(folderId);
      else options.onCancel();
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

// ---------------------------------------------------------------------------
// Picker session controller
//
// Owns the whole launch lifecycle outside React state so that a rapid double
// click cannot pass the guard twice: the lock is a synchronous flag taken
// BEFORE the first await. A monotonic generation invalidates any continuation
// whose session was ended (terminal event) or disposed (unmount).
// ---------------------------------------------------------------------------

export interface PickerTokenGrant {
  accessToken: string;
  apiKey: string;
  appId?: string | null;
}

export interface PickerControllerDeps {
  /** POST picker_token — must only ever be called once per launch. */
  fetchToken: () => Promise<PickerTokenGrant>;
  loadApi: () => Promise<void>;
  getGoogle: () => GoogleNamespace | undefined;
  getOrigin: () => string;
  /** Exactly one select_folder submission per valid picked event. */
  onPicked: (folderId: string) => void | Promise<void>;
  onCancel?: () => void;
  onError: (error: unknown) => void;
  onBusyChange?: (busy: boolean) => void;
  buildPicker?: (options: OpenFolderPickerOptions) => PickerInstance;
}

export interface PickerController {
  open: () => Promise<void>;
  dispose: () => void;
  isActive: () => boolean;
}

export function createPickerController(deps: PickerControllerDeps): PickerController {
  const build = deps.buildPicker ?? openFolderPicker;
  let active = false; // synchronous launch/session lock
  let disposed = false;
  let generation = 0;
  let instance: PickerInstance | null = null;
  let token: string | null = null;

  const hide = () => {
    try {
      instance?.setVisible(false);
    } catch {
      /* ignore */
    }
  };

  const cleanup = () => {
    hide();
    instance = null;
    token = null;
  };

  const endSession = () => {
    cleanup();
    generation += 1; // invalidate any in-flight continuation
    active = false;
    deps.onBusyChange?.(false);
  };

  async function open() {
    if (disposed || active) return; // taken synchronously, before any await
    active = true;
    const session = ++generation;
    const stale = () => disposed || session !== generation;
    deps.onBusyChange?.(true);
    try {
      const grant = await deps.fetchToken();
      if (stale()) return;
      token = grant.accessToken;
      await deps.loadApi();
      if (stale()) {
        token = null;
        return;
      }
      const google = deps.getGoogle();
      if (!google?.picker) throw new Error("Google Picker could not be loaded.");

      let terminal = false;
      const takeTerminal = () => {
        if (terminal || session !== generation) return false;
        terminal = true;
        return true;
      };

      instance = build({
        google,
        accessToken: grant.accessToken,
        apiKey: grant.apiKey,
        appId: grant.appId ?? null,
        origin: deps.getOrigin(),
        onPicked: async (folderId) => {
          if (!takeTerminal()) return;
          cleanup();
          const wasDisposed = disposed;
          try {
            await deps.onPicked(folderId);
          } catch (e) {
            if (!wasDisposed) deps.onError(e);
          } finally {
            if (session === generation) endSession();
          }
        },
        onCancel: () => {
          if (!takeTerminal()) return;
          if (session === generation) endSession();
          else cleanup();
          deps.onCancel?.();
        },
      });

      if (stale()) {
        // Disposed while building: never leave a visible Picker behind.
        cleanup();
      }
    } catch (e) {
      const wasStale = stale();
      cleanup();
      if (!wasStale) {
        endSession();
        deps.onError(e);
      }
    }
  }

  return {
    open,
    dispose: () => {
      disposed = true;
      generation += 1;
      cleanup();
      active = false;
    },
    isActive: () => active,
  };
}
