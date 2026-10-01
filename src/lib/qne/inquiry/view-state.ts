import type { JobDetailsQuery } from "./job-details";
import type { JobDetailsPage } from "./job-details.server";
import { normalizeInquiryPreferences, type InquiryPreferences } from "./preferences";
import { NORMAL_USER_DEFAULT, type InquiryPermission } from "./permissions";
export interface InquiryViewSnapshot {
  draft: JobDetailsQuery;
  query: JobDetailsQuery;
  selectedColumns: string[];
  columnOrder: string[];
  data: JobDetailsPage | null;
  hasApplied: boolean;
  stale: boolean;
  scrollY: number;
}
export interface InquiryViewState {
  identity: string | null;
  grantsKey: string;
  requestRevision: number;
  snapshot: InquiryViewSnapshot;
}
export type InquiryViewEvent =
  | {
      type: "identity";
      identity: string;
      preferences: InquiryPreferences;
      access: InquiryPermission;
    }
  | { type: "grants"; identity: string; access: InquiryPermission | null }
  | { type: "patch"; identity: string; patch: Partial<InquiryViewSnapshot> }
  | { type: "apply"; identity: string; query: JobDetailsQuery }
  | { type: "received"; identity: string; requestRevision: number; data: JobDetailsPage }
  | { type: "stale"; identity: string }
  | { type: "clear" }
  | { type: "invalidate" };
export function grantsKey(access: InquiryPermission | null): string {
  return access
    ? JSON.stringify([
        access.can_view,
        access.scope,
        access.can_export_excel,
        access.view_private_notes,
        access.view_gps,
      ])
    : "";
}
function cold(preferences: InquiryPreferences): InquiryViewSnapshot {
  return {
    draft: preferences.draft,
    query: preferences.applied,
    selectedColumns: preferences.selectedColumns,
    columnOrder: preferences.columnOrder,
    data: null,
    hasApplied: false,
    stale: false,
    scrollY: 0,
  };
}
export function createInquiryView(): InquiryViewState {
  return {
    identity: null,
    grantsKey: "",
    requestRevision: 0,
    snapshot: cold(normalizeInquiryPreferences(null, NORMAL_USER_DEFAULT)),
  };
}
export function transitionInquiryView(
  state: InquiryViewState,
  event: InquiryViewEvent,
): InquiryViewState {
  if (event.type === "invalidate")
    return { ...createInquiryView(), requestRevision: state.requestRevision + 1 };
  if (event.type === "identity")
    return {
      identity: event.identity,
      grantsKey: grantsKey(event.access),
      requestRevision: state.requestRevision + 1,
      snapshot: cold(event.preferences),
    };
  if (event.type === "clear")
    return {
      ...state,
      requestRevision: state.requestRevision + 1,
      snapshot: { ...state.snapshot, data: null, hasApplied: false, stale: false, scrollY: 0 },
    };
  if (event.identity !== state.identity) return state;
  if (event.type === "grants") {
    const key = grantsKey(event.access);
    if (key === state.grantsKey) return state;
    const prefs = normalizeInquiryPreferences(
      {
        version: 1,
        draft: state.snapshot.draft,
        applied: state.snapshot.query,
        selectedColumns: state.snapshot.selectedColumns,
        columnOrder: state.snapshot.columnOrder,
      },
      event.access ?? NORMAL_USER_DEFAULT,
    );
    return {
      ...state,
      grantsKey: key,
      requestRevision: state.requestRevision + 1,
      snapshot: cold(prefs),
    };
  }
  if (event.type === "received")
    return event.requestRevision === state.requestRevision && state.snapshot.hasApplied
      ? { ...state, snapshot: { ...state.snapshot, data: event.data } }
      : state;
  if (event.type === "apply")
    return {
      ...state,
      requestRevision: state.requestRevision + 1,
      snapshot: {
        ...state.snapshot,
        query: event.query,
        hasApplied: true,
        stale: false,
        data: null,
      },
    };
  if (event.type === "stale")
    return state.snapshot.hasApplied
      ? { ...state, snapshot: { ...state.snapshot, stale: true } }
      : state;
  const queryChanged = event.patch.query && event.patch.query !== state.snapshot.query;
  return {
    ...state,
    requestRevision: state.requestRevision + (queryChanged ? 1 : 0),
    snapshot: { ...state.snapshot, ...event.patch, ...(queryChanged ? { data: null } : {}) },
  };
}
