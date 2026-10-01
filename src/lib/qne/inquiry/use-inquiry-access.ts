import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/qne/session-context";
import { validateInquiryPermission, type InquiryPermission } from "./permissions";
import { inquiryRequest } from "./client";
import type { InquiryIdentity } from "./preferences";
import { grantsKey } from "./view-state";
export function useInquiryAccess() {
  const { token, currentUser, currentUserReady, currentUserToken } = useSession();
  const tenant = currentUser?.tenantCode,
    user = currentUser?.diagnostics?.matchedN3UserId;
  const identity = useMemo<InquiryIdentity | null>(
    () =>
      token && currentUserReady && currentUserToken === token && tenant && user
        ? { tenantCode: tenant, userId: user }
        : null,
    [token, currentUserReady, currentUserToken, tenant, user],
  );
  const identityKey = identity ? JSON.stringify([identity.tenantCode, identity.userId]) : null;
  const [state, setState] = useState<{
    identity: string | null;
    access: InquiryPermission | null;
    error: string;
  }>({ identity: null, access: null, error: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!token || !identityKey) return;
    let controller: AbortController;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      setState((previous) => ({
        identity: identityKey,
        access: previous.identity === identityKey ? previous.access : null,
        error: "",
      }));
      void inquiryRequest("/api/inquiries/access", token, { signal })
        .then((r) => r.json())
        .then((body) => {
          const validated = validateInquiryPermission(body.access);
          if (!validated.ok) throw new Error("Unable to verify inquiry access.");
          if (!signal.aborted)
            setState((previous) => ({
              identity: identityKey,
              access:
                previous.identity === identityKey &&
                grantsKey(previous.access) === grantsKey(validated.value)
                  ? previous.access
                  : validated.value,
              error: "",
            }));
        })
        .catch((error) => {
          if (!signal.aborted)
            setState({
              identity: identityKey,
              access: null,
              error: error instanceof Error ? error.message : "Unable to check inquiry access.",
            });
        });
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      controller?.abort();
      window.removeEventListener("focus", load);
    };
  }, [token, identityKey, revision]);
  const current = state.identity === identityKey && !!identityKey;
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  const identityFailed =
    !!token && currentUserReady && (!currentUser || (currentUserToken === token && !identity));
  const identityError = identityFailed
    ? "Unable to verify your Inquiry identity. Reopen ServiceHub from N3."
    : "";
  return {
    access: current ? state.access : null,
    error: identityError || (current ? state.error : ""),
    reload,
    token,
    identity,
    identityKey,
    identityFailed,
  };
}
