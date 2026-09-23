// Accessible Malaysian date field (WP3C UAT correction).
//
// Native `input[type=date]` renders MM/DD/YYYY under US browser locales, so the
// visible control here is a plain text field that always shows and accepts
// DD/MM/YYYY. A hidden native date input is used purely as the calendar
// popover, so no extra package is needed. The value handed to the caller is
// always ISO `yyyy-mm-dd` (or "" when cleared), keeping API/query contracts
// unchanged.

import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";

import {
  MALAYSIA_DATE_PLACEHOLDER,
  formatMalaysiaDate,
  malaysiaCurrentMonthStartIso,
  parseMalaysiaDate,
} from "@/lib/qne/malaysia-date";

export interface MalaysiaDateInputProps {
  /** ISO `yyyy-mm-dd`, or "" when unset. */
  value: string;
  /** Receives ISO `yyyy-mm-dd`, or "" when cleared. */
  onChange: (iso: string) => void;
  label?: string;
  id?: string;
  className?: string;
  "aria-label"?: string;
}

export function MalaysiaDateInput({
  value,
  onChange,
  label,
  id,
  className,
  ...rest
}: MalaysiaDateInputProps) {
  const [text, setText] = useState(() => formatMalaysiaDate(value));
  const [invalid, setInvalid] = useState(false);
  const pickerRef = useRef<HTMLInputElement | null>(null);
  // Fresh entry opens on the current Malaysia month; once the user navigates
  // and picks, their choice anchors the calendar for the rest of the session.
  const [anchor, setAnchor] = useState(() => value || malaysiaCurrentMonthStartIso());

  useEffect(() => {
    setText(formatMalaysiaDate(value));
    setInvalid(false);
    if (value) setAnchor(value);
  }, [value]);

  const commit = (next: string) => {
    setText(next);
    const parsed = parseMalaysiaDate(next);
    if (parsed === null) {
      setInvalid(next.trim().length > 0);
      return;
    }
    setInvalid(false);
    if (parsed !== value) onChange(parsed);
  };

  const field = (
    <div
      className={`relative flex min-h-11 w-full items-center rounded-md border bg-background pr-10 ${
        invalid ? "border-destructive" : ""
      } ${className ?? ""}`}
    >
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={MALAYSIA_DATE_PLACEHOLDER}
        aria-label={rest["aria-label"] ?? label}
        aria-invalid={invalid || undefined}
        value={text}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => {
          if (parseMalaysiaDate(text) === null) {
            setText(formatMalaysiaDate(value));
            setInvalid(false);
          }
        }}
        className="min-h-11 w-full min-w-0 rounded-md bg-transparent px-3 text-sm font-normal text-foreground outline-none"
      />
      <button
        type="button"
        aria-label={`${label ?? "Date"} — open calendar`}
        onClick={() => {
          const el = pickerRef.current;
          if (!el) return;
          if (typeof el.showPicker === "function") el.showPicker();
          else el.click();
        }}
        className="absolute right-0 top-0 grid h-full w-10 place-items-center rounded-r-md text-muted-foreground hover:text-foreground"
      >
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
      </button>
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value || anchor}
        onChange={(e) => {
          const iso = e.target.value;
          if (iso) setAnchor(iso);
          onChange(iso);
        }}
        className="pointer-events-none absolute right-2 top-1/2 h-0 w-0 -translate-y-1/2 opacity-0"
      />
    </div>
  );

  if (!label) return field;

  return (
    <label className="block text-xs font-semibold text-muted-foreground" htmlFor={id}>
      {label}
      <div className="mt-1">{field}</div>
    </label>
  );
}
