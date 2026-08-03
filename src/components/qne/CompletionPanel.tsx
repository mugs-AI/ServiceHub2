// Completion panel (Run 7 Phase O/P/Q).
// Software-service completion form: checklist, diagnosis / action / test result,
// acknowledgement per tenant rule, signature pad and Owner/Admin waiver.

import { useCallback, useEffect, useRef, useState } from "react";

import { formatMYDateTime } from "@/lib/format-date";
import { getStoredToken } from "@/lib/qne/tokens";
import { defaultChecklist, type ChecklistItem } from "@/lib/qne/service-jobs/field-ops";
import {
  ACK_METHOD_LABEL,
  type AckMethod,
  type CompletionSettings,
} from "@/lib/qne/service-jobs/tenant-settings";

function authHeaders(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const BTN =
  "min-h-11 rounded-md border px-3 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-50";
const BTN_PRIMARY =
  "min-h-11 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50";
const INPUT = "min-h-11 w-full rounded-md border bg-background px-2 text-sm";
const AREA = "w-full rounded-md border bg-background p-2 text-sm";

interface CompletionResponse {
  completion: Record<string, unknown> | null;
  settings: CompletionSettings;
  requirement: { required: boolean; reason: string };
  canWaive: boolean;
  jobStatus: string;
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  return (
    <div>
      <canvas
        ref={ref}
        width={600}
        height={200}
        className="h-40 w-full touch-none rounded-md border bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = ref.current!.getContext("2d")!;
          const p = pos(e);
          ctx.lineWidth = 2.5;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#111827";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          (e.target as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext("2d")!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          dirty.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (dirty.current) onChange(ref.current!.toDataURL("image/png"));
        }}
      />
      <button
        type="button"
        className={BTN + " mt-2"}
        onClick={() => {
          const c = ref.current!;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          dirty.current = false;
          onChange(null);
        }}
      >
        Clear signature
      </button>
    </div>
  );
}

export function CompletionPanel({
  jobId,
  jobNumber,
  onCompleted,
}: {
  jobId: string;
  jobNumber: string;
  onCompleted: () => void | Promise<void>;
}) {
  const [meta, setMeta] = useState<CompletionResponse | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(defaultChecklist());
  const [form, setForm] = useState<Record<string, string>>({});
  const [followUp, setFollowUp] = useState(false);
  const [ackConfirmed, setAckConfirmed] = useState(false);
  const [ackMethod, setAckMethod] = useState<string>("");
  const [signature, setSignature] = useState<string | null>(null);
  const [waive, setWaive] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const load = useCallback(async () => {
    const res = await fetch(`/api/workspace/jobs/${jobId}/complete`, { headers: authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setMeta(body as CompletionResponse);
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!meta) return null;

  const done = meta.jobStatus === "Completed";

  if (done) {
    const c = meta.completion ?? {};
    return (
      <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Completion
        </h2>
        <p className="mt-2 text-sm text-foreground">
          This Job is completed. The completion record is locked.
        </p>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Resolution summary" value={String(c.resolution_summary ?? "—")} />
          <Row label="Action taken" value={String(c.work_performed ?? "—")} />
          <Row label="Test result" value={String(c.test_result ?? "—")} />
          <Row
            label="Acknowledgement"
            value={
              c.signature_waived
                ? `Waived — ${String(c.signature_waiver_reason ?? "")}`
                : `${ACK_METHOD_LABEL[(c.ack_method as AckMethod) ?? "signature"] ?? String(c.ack_method ?? "—")} · ${String(c.ack_customer_name ?? "")}`
            }
          />
          <Row label="Recorded at" value={formatMYDateTime(String(c.created_at ?? ""))} />
        </dl>
        <a
          href={`/jobs/${jobId}/completion-report`}
          target="_blank"
          rel="noreferrer"
          className={BTN_PRIMARY + " mt-4 inline-flex items-center"}
        >
          Open Service Report ({jobNumber})
        </a>
      </section>
    );
  }

  const methods = meta.settings.allowedMethods;

  async function submit() {
    setBusy(true);
    setErrors([]);
    try {
      const payload = {
        checklist,
        diagnosis: form.diagnosis ?? "",
        software_module: form.software_module ?? "",
        version_after: form.version_after ?? "",
        resolution_summary: form.resolution_summary ?? "",
        work_performed: form.work_performed ?? "",
        test_result: form.test_result ?? "",
        internal_completion_note: form.internal_completion_note ?? "",
        outstanding_issue: form.outstanding_issue ?? "",
        follow_up_required: followUp,
        follow_up_date: form.follow_up_date ?? "",
        ack_method: waive ? "admin_waiver" : ackMethod,
        ack_evidence_reference: form.ack_evidence_reference ?? "",
        ack_customer_name: form.ack_customer_name ?? "",
        ack_customer_role: form.ack_customer_role ?? "",
        ack_remark: form.ack_remark ?? "",
        ack_confirmed: ackConfirmed,
        signature_data_url: signature,
        signature_waived: waive,
        signature_waiver_reason: form.signature_waiver_reason ?? "",
      };
      const res = await fetch(`/api/workspace/jobs/${jobId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(body?.errors ?? [body?.error ?? `HTTP ${res.status}`]);
        return;
      }
      await load();
      await onCompleted();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Completion failed."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Completion
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Acknowledgement: {meta.requirement.required ? "Required" : "Optional"} —{" "}
        {meta.requirement.reason}
      </p>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Checklist
      </h3>
      <ul className="mt-2 space-y-2">
        {checklist.map((item, i) => (
          <li key={item.label} className="rounded-lg border bg-background/60 p-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <span className="truncate text-sm font-medium">{item.label}</span>
              <select
                value={item.state}
                onChange={(e) =>
                  setChecklist((p) =>
                    p.map((x, j) =>
                      j === i ? { ...x, state: e.target.value as ChecklistItem["state"] } : x,
                    ),
                  )
                }
                className="min-h-11 shrink-0 rounded-md border bg-background px-2 text-sm"
              >
                <option value="pending">Pending</option>
                <option value="done">Done</option>
                <option value="not_applicable">Not applicable</option>
              </select>
            </div>
            {item.state === "not_applicable" && (
              <input
                placeholder="Why is this not applicable?"
                value={item.note ?? ""}
                onChange={(e) =>
                  setChecklist((p) => p.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))
                }
                className={INPUT + " mt-2"}
              />
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Labeled label="Diagnosis *">
          <textarea rows={3} className={AREA} onChange={(e) => set("diagnosis", e.target.value)} />
        </Labeled>
        <Labeled label="Action taken *">
          <textarea
            rows={3}
            className={AREA}
            onChange={(e) => set("work_performed", e.target.value)}
          />
        </Labeled>
        <Labeled label="Test result *">
          <textarea
            rows={3}
            className={AREA}
            onChange={(e) => set("test_result", e.target.value)}
          />
        </Labeled>
        <Labeled label="Resolution summary *">
          <textarea
            rows={3}
            className={AREA}
            onChange={(e) => set("resolution_summary", e.target.value)}
          />
        </Labeled>
        <Labeled label="Software module">
          <input className={INPUT} onChange={(e) => set("software_module", e.target.value)} />
        </Labeled>
        <Labeled label="Version after service">
          <input className={INPUT} onChange={(e) => set("version_after", e.target.value)} />
        </Labeled>
        <Labeled label="Outstanding issue">
          <textarea
            rows={2}
            className={AREA}
            onChange={(e) => set("outstanding_issue", e.target.value)}
          />
        </Labeled>
        <Labeled label="Internal note (never shown to the customer)">
          <textarea
            rows={2}
            className={AREA}
            onChange={(e) => set("internal_completion_note", e.target.value)}
          />
        </Labeled>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={followUp}
          onChange={(e) => setFollowUp(e.target.checked)}
          className="h-4 w-4"
        />
        Follow-up required
      </label>
      {followUp && (
        <input type="date" className={INPUT + " mt-2"} onChange={(e) => set("follow_up_date", e.target.value)} />
      )}

      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Customer acknowledgement
      </h3>
      {meta.canWaive && (
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={waive}
            onChange={(e) => setWaive(e.target.checked)}
            className="h-4 w-4"
          />
          Waive acknowledgement (Owner / Administrator)
        </label>
      )}

      {waive ? (
        <Labeled label="Waiver reason *">
          <textarea
            rows={2}
            className={AREA}
            onChange={(e) => set("signature_waiver_reason", e.target.value)}
          />
        </Labeled>
      ) : (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Labeled label="Acknowledgement method">
            <select
              value={ackMethod}
              onChange={(e) => setAckMethod(e.target.value)}
              className={INPUT}
            >
              <option value="">Not captured</option>
              {methods.map((m) => (
                <option key={m} value={m}>
                  {ACK_METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Customer name">
            <input className={INPUT} onChange={(e) => set("ack_customer_name", e.target.value)} />
          </Labeled>
          <Labeled label="Customer role / position">
            <input className={INPUT} onChange={(e) => set("ack_customer_role", e.target.value)} />
          </Labeled>
          <Labeled label="Evidence reference (WhatsApp / email)">
            <input
              className={INPUT}
              onChange={(e) => set("ack_evidence_reference", e.target.value)}
            />
          </Labeled>
          <Labeled label="Customer remark">
            <textarea rows={2} className={AREA} onChange={(e) => set("ack_remark", e.target.value)} />
          </Labeled>
          {ackMethod === "signature" && (
            <Labeled label="Signature">
              <SignaturePad onChange={setSignature} />
            </Labeled>
          )}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={ackConfirmed}
              onChange={(e) => setAckConfirmed(e.target.checked)}
              className="h-4 w-4"
            />
            The customer has confirmed the work described above.
          </label>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <button type="button" disabled={busy} onClick={() => void submit()} className={BTN_PRIMARY + " mt-4"}>
        {busy ? "Completing…" : "Complete Job"}
      </button>
    </section>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="whitespace-pre-wrap text-sm">{value}</dd>
    </div>
  );
}
