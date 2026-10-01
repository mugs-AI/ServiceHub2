import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useInquiryAccess } from "./use-inquiry-access";
import {
  createInquiryView,
  transitionInquiryView,
  grantsKey,
  type InquiryViewSnapshot,
} from "./view-state";
import { inquiryRequest } from "./client";
import { jobDetailsParams, type JobDetailsQuery } from "./job-details";
import {
  loadInquiryPreferences,
  normalizeInquiryPreferences,
  saveInquiryPreferences,
} from "./preferences";
import type { JobDetailsPage } from "./job-details.server";
const empty = createInquiryView().snapshot;
function useViewController() {
  const verified = useInquiryAccess();
  const {
    identity,
    identityKey,
    access,
    token,
    error: accessError,
    reload: reloadAccess,
    identityFailed,
  } = verified;
  const [state, dispatch] = useReducer(transitionInquiryView, undefined, createInquiryView);
  const [request, setRequest] = useState({ identity: "", revision: -1, loading: false, error: "" });
  const consumed = useRef("");
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const current =
    identityKey !== null && state.identity === identityKey && state.grantsKey === grantsKey(access);
  useEffect(() => {
    if (!identityKey || !identity || !access) {
      controller.current?.abort();
      if (identityFailed && state.identity !== null) dispatch({ type: "invalidate" });
      if (identityKey && accessError)
        dispatch({ type: "grants", identity: identityKey, access: null });
      return;
    }
    if (state.identity !== identityKey) {
      let prefs = normalizeInquiryPreferences(null, access);
      try {
        prefs = loadInquiryPreferences(window.localStorage, identity, access);
      } catch {
        /* disabled browser storage */
      }
      dispatch({ type: "identity", identity: identityKey, preferences: prefs, access });
    } else {
      if (state.grantsKey !== grantsKey(access)) controller.current?.abort();
      dispatch({ type: "grants", identity: identityKey, access });
    }
  }, [identity, identityKey, identityFailed, access, accessError, state.identity, state.grantsKey]);
  useEffect(() => {
    if (!current || !identity || !access?.can_view) return;
    try {
      saveInquiryPreferences(window.localStorage, identity, {
        version: 1,
        draft: state.snapshot.draft,
        applied: state.snapshot.query,
        selectedColumns: state.snapshot.selectedColumns,
        columnOrder: state.snapshot.columnOrder,
      });
    } catch {
      /* disabled browser storage */
    }
  }, [
    current,
    identity,
    identityKey,
    access,
    state.snapshot.draft,
    state.snapshot.query,
    state.snapshot.selectedColumns,
    state.snapshot.columnOrder,
  ]);
  useEffect(() => {
    // Revision, not route mounting/focus, is the only trigger for a result read.
    const key = `${identityKey}:${state.requestRevision}`;
    if (
      !current ||
      !access?.can_view ||
      !state.snapshot.hasApplied ||
      !token ||
      !identityKey ||
      consumed.current === key
    )
      return;
    consumed.current = key;
    pending.current = true;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    const revision = state.requestRevision;
    setRequest({ identity: identityKey, revision, loading: true, error: "" });
    void inquiryRequest(
      `/api/inquiries/job-details?${jobDetailsParams(state.snapshot.query)}`,
      token,
      { signal: next.signal },
    )
      .then((r) => r.json())
      .then((body: JobDetailsPage) => {
        if (next.signal.aborted) return;
        // Server may return narrower grants than the background access check.
        if (grantsKey(body.access) !== grantsKey(access)) {
          dispatch({ type: "grants", identity: identityKey, access: body.access });
          reloadAccess();
        } else
          dispatch({
            type: "received",
            identity: identityKey,
            requestRevision: revision,
            data: body,
          });
      })
      .catch((e) => {
        if (!next.signal.aborted)
          setRequest({
            identity: identityKey,
            revision,
            loading: false,
            error: e instanceof Error ? e.message : "Unable to load Jobs.",
          });
      })
      .finally(() => {
        if (controller.current === next) pending.current = false;
        if (!next.signal.aborted)
          setRequest((previous) =>
            previous.identity === identityKey && previous.revision === revision
              ? { ...previous, loading: false }
              : previous,
          );
      });
  }, [
    current,
    identityKey,
    token,
    access,
    state.requestRevision,
    state.snapshot.hasApplied,
    state.snapshot.query,
    reloadAccess,
  ]);
  // Abort immediately on credential or actor changes, including unverified transitions.
  useEffect(
    () => () => {
      if (pending.current) consumed.current = "";
      controller.current?.abort();
    },
    [token, identityKey],
  );
  const update = useCallback(
    (patch: Partial<InquiryViewSnapshot>) => {
      if (identityKey) dispatch({ type: "patch", identity: identityKey, patch });
    },
    [identityKey],
  );
  const apply = useCallback(
    (query: JobDetailsQuery) => {
      if (identityKey && access?.can_view)
        dispatch({ type: "apply", identity: identityKey, query });
    },
    [identityKey, access],
  );
  const markStale = useCallback(() => {
    if (identityKey) dispatch({ type: "stale", identity: identityKey });
  }, [identityKey]);
  const clear = useCallback(() => {
    controller.current?.abort();
    dispatch({ type: "clear" });
  }, []);
  return {
    access,
    accessError,
    token,
    identity,
    identityKey,
    snapshot: current ? state.snapshot : empty,
    update,
    apply,
    markStale,
    clear,
    reloadAccess,
    loading:
      current &&
      request.identity === identityKey &&
      request.revision === state.requestRevision &&
      request.loading,
    error:
      current && request.identity === identityKey && request.revision === state.requestRevision
        ? request.error
        : "",
  };
}
type InquiryView = ReturnType<typeof useViewController>;
const Context = createContext<InquiryView | null>(null);
export function InquiryViewProvider({ children }: { children: ReactNode }) {
  const view = useViewController();
  return <Context.Provider value={view}>{children}</Context.Provider>;
}
export function useInquiryView(): InquiryView {
  const view = useContext(Context);
  if (!view) throw new Error("InquiryViewProvider is required.");
  return view;
}
