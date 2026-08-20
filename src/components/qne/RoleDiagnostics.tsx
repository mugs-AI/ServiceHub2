// Read-only Role Diagnostics for the CURRENT authenticated session.
//
// Single authority: it renders `currentUser` / `currentUser.diagnostics` as
// already resolved server-side by /api/session/me. It never calls N3, never
// creates a second role-resolution path, and never exposes tokens or secrets.

import { useSession } from "@/lib/qne/session-context";

const GATE_LABEL: Record<string, string> = {
  n3_owner: "Official N3 tenant Owner (isOwner=true)",
  allowlist: "Tenant-scoped ServiceHub allowlist (emergency fallback)",
  bootstrap: "First-user bootstrap (emergency fallback)",
  none: "Not an administrator",
};

const REASON_LABEL: Record<string, string> = {
  matched_owner: "Matched N3 user has isOwner = true",
  matched_not_owner: "Matched N3 user has isOwner = false",
  no_matching_user: "No matching N3 user in /api/Users",
  users_endpoint_failed: "/api/Users request failed",
  users_endpoint_unauthorized: "/api/Users returned 401 Unauthorized",
  users_endpoint_forbidden: "/api/Users returned 403 Forbidden",
  identity_missing: "N3 JWT did not carry a user identifier",
  allowlist_fallback: "Granted via tenant allowlist (emergency fallback)",
  bootstrap_fallback: "Granted as first user of this tenant (emergency fallback)",
};

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {k}
      </dt>
      <dd className="mt-0.5 break-words text-foreground">{v}</dd>
    </div>
  );
}

export function RoleDiagnostics() {
  const { currentUser } = useSession();
  const d = currentUser?.diagnostics;
  const ep = d?.usersEndpoint;
  const endpointText = ep
    ? ep.status === "ok"
      ? `ok — ${ep.count} users (${ep.shape})`
      : `${ep.status}${ep.httpStatus ? ` (${ep.httpStatus})` : ""} — ${ep.error ?? "unknown"}`
    : "—";

  return (
    <div className="rounded-xl border bg-card p-4 text-xs shadow-sm">
      <dl className="grid gap-2 sm:grid-cols-2">
        <Row k="Identity source" v={d?.identitySource ?? "—"} />
        <Row k="Identity identifier" v={d?.identityUserIdentifier ?? "—"} />
        <Row k="Matched N3 user id" v={d?.matchedN3UserId ?? "—"} />
        <Row k="Matched display name" v={d?.matchedDisplayName ?? "—"} />
        <Row k="isOwner" v={currentUser?.isOwner ? "true" : "false"} />
        <Row
          k="Role names"
          v={currentUser?.roleNames?.length ? currentUser.roleNames.join(", ") : "—"}
        />
        <Row k="isAdministrator" v={currentUser?.isAdministrator ? "true" : "false"} />
        <Row k="Admin gate" v={GATE_LABEL[currentUser?.adminGate ?? "none"] ?? "—"} />
        <Row k="Reason" v={REASON_LABEL[d?.reason ?? "no_matching_user"] ?? d?.reason ?? "—"} />
        <Row k="/api/Users" v={endpointText} />
      </dl>
    </div>
  );
}
