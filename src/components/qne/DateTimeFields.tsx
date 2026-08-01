// Separate Date + Time controls for appointment entry (Malaysia time).
//
// - Date: dd/mm/yyyy text entry with an in-field calendar picker; value is ISO.
// - Time: controlled dropdown, 30-minute increments only, 07:00 AM–11:30 PM.
// No native minute spinners anywhere.

import { useEffect, useRef, useState } from "react";
import { Calendar } from "lucide-react";

import { TIME_SLOTS, slotLabel, toDisplayDate } from "@/lib/qne/service-jobs/scheduling";

function displayToIso(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCDate() !== d) return null;
  return iso;
}

export function DateField({
  label,
  value,
  onChange,
  id,
}: {
  label: string;
  value: string; // ISO yyyy-mm-dd
  onChange: (iso: string) => void;
  id?: string;
}) {
  const [text, setText] = useState(() => toDisplayDate(value));
  const pickerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setText(toDisplayDate(value));
  }, [value]);

  return (
    <label className="block text-xs font-semibold text-muted-foreground" htmlFor={id}>
      {label}
      <div className="relative mt-1 flex min-h-11 w-full items-center rounded-md border bg-background pr-10">
        <input
          id={id}
          inputMode="numeric"
          placeholder="dd/mm/yyyy"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const iso = displayToIso(e.target.value);
            if (iso) onChange(iso);
          }}
          onBlur={() => setText(toDisplayDate(value))}
          className="min-h-11 w-full min-w-0 rounded-md bg-transparent px-3 text-sm font-normal text-foreground outline-none"
        />
        <button
          type="button"
          aria-label={`${label} — open calendar`}
          onClick={() => {
            const el = pickerRef.current;
            if (!el) return;
            if (typeof el.showPicker === "function") el.showPicker();
            else el.click();
          }}
          className="absolute right-0 top-0 grid h-full w-10 place-items-center rounded-r-md text-muted-foreground hover:text-foreground"
        >
          <Calendar className="h-4 w-4" aria-hidden />
        </button>
        <input
          ref={pickerRef}
          type="date"
          tabIndex={-1}
          aria-hidden
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pointer-events-none absolute right-2 top-1/2 h-0 w-0 -translate-y-1/2 opacity-0"
        />
      </div>
    </label>
  );
}

export function TimeField({
  label,
  value,
  onChange,
  id,
}: {
  label: string;
  value: string; // HH:mm
  onChange: (hhmm: string) => void;
  id?: string;
}) {
  return (
    <label className="block text-xs font-semibold text-muted-foreground" htmlFor={id}>
      {label}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm font-normal text-foreground"
      >
        {!value && <option value="">Select time</option>}
        {TIME_SLOTS.map((t) => (
          <option key={t} value={t}>
            {slotLabel(t)}
          </option>
        ))}
      </select>
    </label>
  );
}
