import { useEffect, useState } from "react";
import { useSession } from "@/lib/qne/session-context";
import type { InquiryPermission } from "./permissions";
import { inquiryRequest } from "./client";
export function useInquiryAccess() {
  const { token, currentUser } = useSession(),
    identity = `${currentUser?.tenantCode ?? ""}:${currentUser?.diagnostics?.matchedN3UserId ?? ""}`;
  const [state, setState] = useState<{
    token: string | null;
    identity: string;
    access: InquiryPermission | null;
    error: string;
  }>({ token: null, identity: "", access: null, error: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!token || !identity) return;
    let controller: AbortController;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      setState({ token, identity, access: null, error: "" });
      void inquiryRequest("/api/inquiries/access", token, { signal })
        .then((r) => r.json())
        .then((body) => {
          if (!signal.aborted) setState({ token, identity, access: body.access, error: "" });
        })
        .catch((error) => {
          if (!signal.aborted)
            setState({
              token,
              identity,
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
  }, [token, identity, revision]);
  const current = state.token === token && state.identity === identity;
  return {
    access: current ? state.access : null,
    error: current ? state.error : "",
    reload: () => setRevision((v) => v + 1),
    token,
  };
}
