// WP2A — Owner/Admin Google Drive tenant connection card (Settings).
//
// The browser never receives refresh tokens or the Client Secret. The only
// token this component can hold is a short-lived Google Picker access token,
// kept in a React ref (memory only) and cleared after the picker closes.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ATTACHMENTS_NOT_IMPLEMENTED_NOTICE,
  DEFAULT_ROOT_FOLDER_NAME,
  NOT_CONNECTED,
  PUBLIC_SHARING_CONFIRMATION,
  PUBLIC_SHARING_WARNING,
  SHARING_LABEL,
  SHARING_READ_ONLY_NOTICE,
  SHARING_UNKNOWN_RECOVERY,
  type PublicDriveConnection,
} from "@/lib/qne/storage/google-drive";
import { getStoredToken } from "@/lib/qne/tokens";

interface AuditRow {
  action: string;
  actor_name: string | null;
  created_at: string;
}

interface StatusPayload {
  connection: PublicDriveConnection;
  configured: boolean;
  missingEnv: string[];
  requiredEnv: string[];
  redirectUri: string;
  scope: string;
  pickerApiKeyConfigured: boolean;
  audit: AuditRow[];
  error?: string;
}

function authHeaders(json = false): Record<string, string> {
  const token = getStoredToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

const STATUS_LABEL: Record<string, string> = {
  not_connected: "Not connected",
  connected: "Connected",
  needs_reconnect: "Action needed — reconnect",
  error: "Error",
  disconnected: "Disconnected",
};

export function GoogleDriveCard({
  onNotify,
}: {
  onNotify: (kind: "ok" | "err", msg: string) => void;
}) {
  const [state, setState] = useState<StatusPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [folderName, setFolderName] = useState(DEFAULT_ROOT_FOLDER_NAME);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Picker token lives ONLY here, in memory, for the life of the picker.
  const pickerToken = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/google-drive/connection", {
        headers: authHeaders(),
      });
      const body = (await res.json().catch(() => ({}))) as StatusPayload;
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setState(body);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load Google Drive status");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Surface the callback outcome without ever reading codes or tokens.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("drive");
    if (!outcome) return;
    onNotify(
      outcome === "connected" ? "ok" : "err",
      outcome === "connected"
        ? "Google Drive connected."
        : "Google Drive connection was not completed. Start Connect Google Drive again.",
    );
    params.delete("drive");
    const q = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (q ? `?${q}` : ""));
    void load();
  }, [load, onNotify]);

  async function post(payload: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      const res = await fetch("/api/integrations/google-drive/connection", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(
          [body.error, body.recovery].filter(Boolean).join(" ") || `HTTP ${res.status}`,
        );
      }
      return body;
    } finally {
      setBusy(null);
      void load();
    }
  }

  async function connect() {
    setBusy("connect");
    try {
      const res = await fetch("/api/integrations/google-drive/connect", {
        method: "POST",
        headers: authHeaders(true),
        body: "{}",
      });
      const body = (await res.json().catch(() => ({}))) as {
        authorizationUrl?: string;
        error?: string;
      };
      if (!res.ok || !body.authorizationUrl) throw new Error(body.error ?? `HTTP ${res.status}`);
      window.location.href = body.authorizationUrl;
    } catch (e) {
      onNotify("err", e instanceof Error ? e.message : "Failed to start connection");
      setBusy(null);
    }
  }

  async function openPicker() {
    setBusy("picker");
    try {
      const res = await fetch("/api/integrations/google-drive/connection", {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ action: "picker_token" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        accessToken?: string;
        apiKey?: string;
        appId?: string | null;
        error?: string;
        recovery?: string;
      };
      if (!res.ok || !body.accessToken || !body.apiKey) {
        throw new Error([body.error, body.recovery].filter(Boolean).join(" "));
      }
      pickerToken.current = body.accessToken;
      await loadGoogleApi();
      const g = (window as unknown as { google?: GoogleNamespace }).google;
      if (!g?.picker) throw new Error("Google Picker could not be loaded.");
      const view = new g.picker.DocsView(g.picker.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true);
      const builder = new g.picker.PickerBuilder()
        .setOAuthToken(pickerToken.current)
        .setDeveloperKey(body.apiKey)
        .addView(view)
        .enableFeature(g.picker.Feature.SUPPORT_DRIVES)
        .setCallback((data: PickerData) => {
          if (data.action === "picked" && data.docs?.[0]?.id) {
            const folderId = data.docs[0].id;
            pickerToken.current = null; // token discarded immediately
            void post({ action: "select_folder", folderId }, "select")
              .then(() => onNotify("ok", "Root Folder saved after Google revalidation."))
              .catch((e) => onNotify("err", e instanceof Error ? e.message : String(e)));
          }
          if (data.action === "cancel") pickerToken.current = null;
        });
      if (body.appId) builder.setAppId(body.appId);
      builder.build().setVisible(true);
    } catch (e) {
      pickerToken.current = null;
      onNotify("err", e instanceof Error ? e.message : "Google Picker failed");
    } finally {
      setBusy(null);
    }
  }

  const conn = state?.connection ?? NOT_CONNECTED;
  const connected = conn.status === "connected" || conn.status === "needs_reconnect";

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Google Drive — Company Storage Connection
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Your company connects and owns its own Google Drive. MUGS operates the Google
            application; your files stay in your Drive. Only the{" "}
            <span className="font-mono">drive.file</span> permission is requested, so ServiceHub can
            only see folders and files you choose or it creates.
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            conn.status === "connected"
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
              : conn.status === "not_connected" || conn.status === "disconnected"
                ? "bg-muted text-muted-foreground"
                : "bg-destructive/10 text-destructive"
          }`}
        >
          {STATUS_LABEL[conn.status] ?? conn.status}
        </span>
      </div>

      <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        {ATTACHMENTS_NOT_IMPLEMENTED_NOTICE}
      </p>

      {loadError && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {loadError}
        </p>
      )}

      {state && !state.configured && (
        <div className="mt-3 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Not configured for this deployment yet.</p>
          <p className="mt-1">
            Missing server-only settings:{" "}
            <span className="font-mono">{state.missingEnv.join(", ")}</span>. Google Cloud must also
            allow this exact redirect URI:{" "}
            <span className="font-mono break-all">{state.redirectUri}</span>
          </p>
        </div>
      )}

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Google account</dt>
          <dd className="font-medium text-foreground">{conn.accountEmail ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Root Folder</dt>
          <dd className="font-medium text-foreground">
            {conn.rootFolderName ?? "Not selected"}
            {conn.driveContext
              ? ` (${conn.driveContext === "shared_drive" ? "Shared Drive" : "My Drive"})`
              : ""}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last test</dt>
          <dd className="text-foreground">{conn.lastTestResult ?? "Never tested"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sharing (read from Google)</dt>
          <dd className="text-foreground">
            {SHARING_LABEL[conn.detectedSharing]}
            {conn.sharingCheckedAt
              ? ` — checked ${conn.sharingCheckedAt.slice(0, 19).replace("T", " ")}`
              : ""}
          </dd>
        </div>
      </dl>

      {conn.lastError && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {conn.lastError}
        </p>
      )}

      {conn.detectedSharing === "anyone_with_link" && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          {PUBLIC_SHARING_WARNING}
          {conn.publicSharingAcknowledged && conn.sharingConfirmedBy
            ? ` Risk confirmed by ${conn.sharingConfirmedBy}${
                conn.sharingConfirmedAt ? ` on ${conn.sharingConfirmedAt.slice(0, 10)}` : ""
              }.`
            : " Not yet acknowledged by an Owner/Admin."}
        </p>
      )}

      {(conn.detectedSharing === "unknown" || conn.detectedSharing === "error") &&
        conn.rootFolderId && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {SHARING_UNKNOWN_RECOVERY}
            {conn.sharingDetail ? ` (${conn.sharingDetail})` : ""}
          </p>
        )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => void connect()}
          disabled={!state?.configured || busy !== null}
          className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {connected ? "Reconnect" : "Connect Google Drive"}
        </button>
        <button
          onClick={() =>
            void post({ action: "create_folder", name: folderName }, "create")
              .then(() => onNotify("ok", "Folder created and set as Root Folder."))
              .catch((e) => onNotify("err", e instanceof Error ? e.message : String(e)))
          }
          disabled={!connected || busy !== null}
          className="rounded-md border px-3 py-2 text-xs font-medium disabled:opacity-50"
        >
          Create New Folder
        </button>
        <button
          onClick={() => void openPicker()}
          disabled={!connected || busy !== null}
          className="rounded-md border px-3 py-2 text-xs font-medium disabled:opacity-50"
        >
          Select Existing Folder
        </button>
        <button
          onClick={() =>
            void post({ action: "test" }, "test")
              .then((b) => onNotify(b.ok ? "ok" : "err", String(b.message ?? "Test completed.")))
              .catch((e) => onNotify("err", e instanceof Error ? e.message : String(e)))
          }
          disabled={!connected || busy !== null}
          className="rounded-md border px-3 py-2 text-xs font-medium disabled:opacity-50"
        >
          Test Connection
        </button>
        <button
          onClick={() => {
            if (
              !window.confirm(
                "Disconnect Google Drive? Your Drive folder and files are NOT deleted.",
              )
            )
              return;
            void post({ action: "disconnect", confirm: true }, "disconnect")
              .then((b) => onNotify("ok", String(b.message ?? "Disconnected.")))
              .catch((e) => onNotify("err", e instanceof Error ? e.message : String(e)));
          }}
          disabled={!connected || busy !== null}
          className="rounded-md border border-destructive px-3 py-2 text-xs font-medium text-destructive disabled:opacity-50"
        >
          Disconnect
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <label className="text-muted-foreground" htmlFor="gd-folder-name">
          New folder name
        </label>
        <input
          id="gd-folder-name"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-xs"
        />
      </div>

      <div className="mt-4 rounded-md border p-3">
        <p className="text-xs font-medium text-foreground">Sharing status</p>
        <p className="mt-1 text-xs text-muted-foreground">{SHARING_READ_ONLY_NOTICE}</p>
        <p className="mt-1 text-xs text-foreground">
          {SHARING_LABEL[conn.detectedSharing]}
          {conn.sharingDetail ? ` — ${conn.sharingDetail}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() =>
              void post({ action: "refresh_sharing" }, "sharing")
                .then((b) => onNotify(b.ok ? "ok" : "err", String(b.message ?? "Sharing checked.")))
                .catch((e) => onNotify("err", e instanceof Error ? e.message : String(e)))
            }
            disabled={!connected || !conn.rootFolderId || busy !== null}
            className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Check sharing on Google
          </button>
          {conn.detectedSharing === "anyone_with_link" && !conn.publicSharingAcknowledged && (
            <button
              onClick={() => {
                if (!window.confirm(PUBLIC_SHARING_CONFIRMATION)) return;
                void post({ action: "acknowledge_public_sharing", confirm: true }, "sharing")
                  .then(() => onNotify("ok", "Public sharing risk confirmation recorded."))
                  .catch((e) => onNotify("err", e instanceof Error ? e.message : String(e)));
              }}
              disabled={busy !== null}
              className="rounded-md border border-destructive px-3 py-1.5 text-xs text-destructive disabled:opacity-50"
            >
              Confirm public sharing risk
            </button>
          )}
        </div>
      </div>

      {state?.audit?.length ? (
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Recent activity</summary>
          <ul className="mt-2 space-y-1">
            {state.audit.map((a, i) => (
              <li key={i} className="text-muted-foreground">
                <span className="font-mono">{a.created_at.slice(0, 19).replace("T", " ")}</span> —{" "}
                {a.action} {a.actor_name ? `by ${a.actor_name}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------- Google Picker ----

interface PickerData {
  action: string;
  docs?: { id?: string }[];
}

interface GoogleNamespace {
  picker?: {
    DocsView: new (viewId: unknown) => {
      setIncludeFolders: (v: boolean) => {
        setSelectFolderEnabled: (v: boolean) => unknown;
      };
    };
    ViewId: { FOLDERS: unknown };
    Feature: { SUPPORT_DRIVES: unknown };
    PickerBuilder: new () => PickerBuilder;
  };
}

interface PickerBuilder {
  setOAuthToken: (t: string) => PickerBuilder;
  setDeveloperKey: (k: string) => PickerBuilder;
  addView: (v: unknown) => PickerBuilder;
  enableFeature: (f: unknown) => PickerBuilder;
  setCallback: (cb: (data: PickerData) => void) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
}

function loadGoogleApi(): Promise<void> {
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
