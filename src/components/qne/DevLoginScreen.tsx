import { useState } from "react";

import { useSession } from "@/lib/qne/session-context";
import { unwrapApiResponse, type ApiEnvelope } from "@/lib/qne/envelope";

interface ConnectData {
  token: string;
  company?: string;
  companyName?: string;
  tenantCode?: string;
  email?: string;
}

/**
 * Dev-only API-key login form. Not rendered in production builds.
 */
export function DevLoginScreen() {
  const { applyToken } = useSession();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const env = (await res.json()) as ApiEnvelope<ConnectData>;
      const data = unwrapApiResponse(env);
      if (!data?.token) throw new Error("Connect response missing token");
      // Wipe the API key from memory immediately after connect.
      setApiKey("");
      await applyToken(data.token, {
        companyName: data.companyName ?? data.company,
        tenantCode: data.tenantCode,
        email: data.email,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground">Developer sign-in</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Local development only. Paste an N3 Open API key to obtain a JWT and
        continue. In production, launch this app from N3 → My Apps → Open.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <label className="block text-sm font-medium text-foreground" htmlFor="api-key">
          N3 API key
        </label>
        <input
          id="api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          placeholder="paste API key"
          required
        />
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !apiKey.trim()}
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
        <p className="text-xs text-muted-foreground">
          The API key is never stored; only the returned JWT is persisted in
          localStorage.
        </p>
      </form>
    </div>
  );
}
