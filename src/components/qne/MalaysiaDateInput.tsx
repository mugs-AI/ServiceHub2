// Accessible Malaysian date field (WP3C UAT correction, WP3C-2 picker).
//
// Native `input[type=date]` renders MM/DD/YYYY under US browser locales, so the
// visible control here is a plain text field that always shows and accepts
// DD/MM/YYYY. The calendar button opens a lightweight in-app day picker in a
// popover (no hidden native proxy input), so it opens reliably from a direct
// tap on iPhone Safari as well as desktop. The value handed to the caller is
// always ISO `yyyy-mm-dd` (or "" when cleared), keeping API/query contracts
// unchanged.

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";

import { MalaysiaDatePopover } from "@/components/qne/MalaysiaDayPicker";
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
      className={`relative flex min-h-11 w-full items-center rounded-md border bg-background pr-11 ${
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
      <MalaysiaDatePopover
        value={value}
        anchor={anchor}
        onSelect={(iso) => {
          setAnchor(iso);
          onChange(iso);
        }}
        trigger={
          <button
            type="button"
            aria-label={`${label ?? "Date"} — open calendar`}
            className="absolute right-0 top-0 grid h-full w-11 place-items-center rounded-r-md text-muted-foreground hover:text-foreground"
          >
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
          </button>
        }
      />
    </div>
  );

  if (!label) return field;

  return (
    <div className="block text-xs font-semibold text-muted-foreground">
      <label htmlFor={id}>{label}</label>
      <div className="mt-1">{field}</div>
    </div>
  );
}
