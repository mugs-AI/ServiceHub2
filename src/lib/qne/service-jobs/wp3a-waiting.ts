// WP3A — Waiting Customer / Waiting Vendor reference: pure rules (no I/O).
//
// The server re-validates every rule in this file inside the waiting
// transaction; the UI uses the same helpers so the two cannot drift.

export const WAITING_PARTIES = ["customer", "vendor"] as const;
export type WaitingParty = (typeof WAITING_PARTIES)[number];

export const MAX_WAITING_REF = 200;

/** The only status a waiting transition may start from. */
export const WAITING_SOURCE_STATUS = "In Progress";

export const WAITING_TARGET_STATUS: Record<WaitingParty, string> = {
  customer: "Waiting Customer",
  vendor: "Waiting Vendor",
};

export const WAITING_ACTION_LABEL: Record<WaitingParty, string> = {
  customer: "Waiting on Customer",
  vendor: "Waiting on Vendor",
};

export const WAITING_REF_LABEL: Record<WaitingParty, string> = {
  customer: "Customer Ref. No.",
  vendor: "Vendor Ref. No.",
};

/** Map a target status back to its party, or null when it is not a waiting status. */
export function waitingPartyForStatus(status: string): WaitingParty | null {
  if (status === WAITING_TARGET_STATUS.customer) return "customer";
  if (status === WAITING_TARGET_STATUS.vendor) return "vendor";
  return null;
}

export interface WaitingInput {
  party: WaitingParty;
  ref_no: string;
}

export type WaitingInputResult =
  | { ok: true; value: WaitingInput }
  | { ok: false; error: string };

/**
 * Strict parse: nothing is coerced. The reference must be a trimmed non-empty
 * string of at most 200 characters. UI validation is never sufficient — this
 * runs on the server for every request.
 */
export function parseWaitingInput(body: unknown): WaitingInputResult {
  const raw = (body ?? {}) as Record<string, unknown>;
  const party = raw.party;
  if (typeof party !== "string" || !(WAITING_PARTIES as readonly string[]).includes(party)) {
    return { ok: false, error: "Unknown waiting party." };
  }
  const ref = raw.ref_no;
  if (typeof ref !== "string" || !ref.trim()) {
    return { ok: false, error: "A reference number is required." };
  }
  const trimmed = ref.trim();
  if (trimmed.length > MAX_WAITING_REF) {
    return {
      ok: false,
      error: `The reference number must be ${MAX_WAITING_REF} characters or fewer.`,
    };
  }
  return { ok: true, value: { party: party as WaitingParty, ref_no: trimmed } };
}

/** Readiness, mirrored by the exact status recheck inside the RPC. */
export function waitingBlockedReason(job: { status: string; is_deleted: boolean }): string | null {
  if (job.is_deleted) return "Deleted jobs cannot be updated.";
  if (job.status !== WAITING_SOURCE_STATUS) {
    return "Only a Job that is In Progress can be moved to a waiting state.";
  }
  return null;
}

/** Display value for the compact latest-reference column ("—" when unset). */
export function refDisplay(value: string | null | undefined): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s || "—";
}
