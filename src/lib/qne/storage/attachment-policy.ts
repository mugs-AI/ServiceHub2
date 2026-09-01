// WP2B — pure Job Attachment policy.
//
// Single source of truth for the WP2B limits, the allow/deny matrix, display
// name sanitisation, delete authority and preview eligibility. It is pure:
// no I/O, no Supabase, no session, no provider calls — so the server routes,
// the UI and the tests cannot drift apart.
//
// Field Operations is frozen: this module deliberately does NOT touch
// `field-ops.ts`. Legacy attachment rows keep the legacy validation they were
// created under; only WP2B (Google Drive) traffic is governed here.

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MiB per file
export const MAX_ACTIVE_FILES = 10; // active files per Job
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // 100 MiB active total per Job

/** v1 is internal-only. The server forces this; there is no UI selector. */
export const FORCED_VISIBILITY = "internal";

/**
 * Extension → accepted MIME types. An extension that is not a key here is
 * rejected, so the allowlist is closed by construction.
 */
export const ALLOWED_BY_EXTENSION: Readonly<Record<string, readonly string[]>> = {
  jpg: ["image/jpeg", "image/jpg"],
  jpeg: ["image/jpeg", "image/jpg"],
  png: ["image/png"],
  heic: ["image/heic", "image/heif"],
  heif: ["image/heic", "image/heif"],
  webp: ["image/webp"],
  pdf: ["application/pdf"],
  txt: ["text/plain"],
  log: ["text/plain"],
  csv: ["text/csv", "text/plain", "application/csv"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  zip: ["application/zip", "application/x-zip-compressed"],
};

/**
 * Extensions that are refused no matter what MIME the browser claims:
 * executables, scripts, macro-enabled Office formats and video. Checked
 * against EVERY dot segment of the file name, so `report.exe.jpg` is refused.
 */
export const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  // executables / installers / libraries
  "exe", "com", "scr", "msi", "msp", "dll", "sys", "drv", "cpl", "jar",
  "app", "dmg", "pkg", "deb", "rpm", "apk", "bin", "run", "gadget",
  // scripts
  "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "mjs", "cjs", "jse",
  "wsf", "wsh", "sh", "bash", "zsh", "php", "py", "pl", "rb", "hta",
  "reg", "lnk", "scf", "inf", "ade", "adp",
  // macro-enabled Office
  "docm", "dotm", "xlsm", "xltm", "xlam", "xlsb", "pptm", "potm", "ppam",
  "ppsm", "sldm",
  // video
  "mp4", "mov", "avi", "wmv", "mkv", "webm", "flv", "m4v", "mpg", "mpeg",
  "3gp", "mts", "m2ts", "ogv",
]);

/** MIME families refused outright (defence in depth beside the extension list). */
export function isBlockedMime(mime: string): boolean {
  const m = mime.trim().toLowerCase();
  if (!m) return false;
  if (m.startsWith("video/")) return true;
  if (m.startsWith("audio/")) return true;
  if (m === "application/x-msdownload") return true;
  if (m === "application/x-msdos-program") return true;
  if (m === "application/x-sh" || m === "application/x-shellscript") return true;
  if (m === "application/javascript" || m === "text/javascript") return true;
  if (m.includes("macroenabled")) return true;
  return false;
}

/** Extensions whose browser MIME is commonly missing or wrong (iOS HEIC). */
const MIME_OPTIONAL_EXTENSIONS: ReadonlySet<string> = new Set(["heic", "heif"]);

/** Files that may be shown inline rather than downloaded. */
export function isPreviewableMime(mime: string): boolean {
  const m = (mime ?? "").trim().toLowerCase();
  return (
    m === "application/pdf" ||
    m === "image/jpeg" ||
    m === "image/jpg" ||
    m === "image/png" ||
    m === "image/webp" ||
    m === "image/heic" ||
    m === "image/heif"
  );
}

/**
 * Sanitised DISPLAY name. Any directory component supplied by the browser is
 * discarded — a user-supplied path is never used for addressing or storage.
 */
export function sanitizeDisplayName(raw: string): string {
  const base = String(raw ?? "")
    .split(/[\\/]/)
    .pop()!
    .trim();
  const cleaned = base
    // Stripping control characters is the point of this rule: they are
    // invisible in a filename and dangerous in headers.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return cleaned.slice(-120) || "attachment";
}

/** All dot segments after the first, lowercased. */
export function extensionSegments(name: string): string[] {
  const base = sanitizeDisplayName(name);
  const parts = base.split(".");
  if (parts.length < 2) return [];
  return parts.slice(1).map((p) => p.trim().toLowerCase());
}

export function fileExtension(name: string): string {
  const segs = extensionSegments(name);
  return segs.length ? segs[segs.length - 1] : "";
}

export interface CandidateFile {
  name: string;
  type: string;
  size: number;
}

export type PolicyResult = { ok: true; displayName: string } | { ok: false; error: string };

/** Per-file validation: extension, MIME, blocklist and size. */
export function validateCandidate(file: CandidateFile): PolicyResult {
  const displayName = sanitizeDisplayName(file.name);
  if (!displayName || displayName === "attachment") {
    if (!String(file.name ?? "").trim()) return { ok: false, error: "A file name is required." };
  }

  const segs = extensionSegments(displayName);
  if (segs.length === 0) {
    return { ok: false, error: "Files must have a recognised file extension." };
  }
  for (const seg of segs) {
    if (BLOCKED_EXTENSIONS.has(seg)) {
      return {
        ok: false,
        error:
          "Executable, script, macro-enabled and video files are not allowed as Job attachments.",
      };
    }
  }

  const ext = segs[segs.length - 1];
  const accepted = ALLOWED_BY_EXTENSION[ext];
  if (!accepted) {
    return { ok: false, error: `".${ext}" files are not an allowed attachment type.` };
  }

  const mime = (file.type ?? "").trim().toLowerCase();
  if (isBlockedMime(mime)) {
    return {
      ok: false,
      error: "Executable, script, macro-enabled and video files are not allowed as Job attachments.",
    };
  }
  if (!mime) {
    // Only HEIC/HEIF may arrive without a MIME type (iOS Safari). Everything
    // else must declare one — the blocklist above is never weakened.
    if (!MIME_OPTIONAL_EXTENSIONS.has(ext)) {
      return {
        ok: false,
        error: `The file type of "${displayName}" could not be determined, so it was not accepted.`,
      };
    }
  } else if (!accepted.includes(mime)) {
    return {
      ok: false,
      error: `"${displayName}" claims to be ${mime}, which does not match a ".${ext}" file.`,
    };
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: `"${displayName}" is empty.` };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `"${displayName}" is larger than the ${MAX_FILE_BYTES / (1024 * 1024)} MB limit for a single attachment.`,
    };
  }
  return { ok: true, displayName };
}

/** Effective MIME stored for a candidate (HEIC without a browser MIME). */
export function effectiveMime(file: CandidateFile): string {
  const mime = (file.type ?? "").trim().toLowerCase();
  if (mime) return mime;
  const ext = fileExtension(file.name);
  return MIME_OPTIONAL_EXTENSIONS.has(ext) ? "image/heic" : "application/octet-stream";
}

export interface QuotaState {
  activeCount: number;
  activeBytes: number;
}

/** Job-level count and total enforcement. Always evaluated on the server. */
export function validateQuota(state: QuotaState, incomingBytes: number): PolicyResult {
  if (state.activeCount >= MAX_ACTIVE_FILES) {
    return {
      ok: false,
      error: `This Job already has the maximum of ${MAX_ACTIVE_FILES} attachments. Delete one before uploading another.`,
    };
  }
  if (state.activeBytes + incomingBytes > MAX_TOTAL_BYTES) {
    return {
      ok: false,
      error: `This upload would exceed the ${MAX_TOTAL_BYTES / (1024 * 1024)} MB total attachment limit for this Job.`,
    };
  }
  return { ok: true, displayName: "" };
}

/* ------------------------------- delete authority ------------------------ */

export interface DeleteActor {
  actorUserId: string | null;
  isAdministrator: boolean;
}

export interface DeleteTarget {
  uploadedByUserId: string | null;
  /** Current Primary PIC of the Job. */
  assignedUserId: string | null;
}

/**
 * Delete is allowed for the uploader, the current Primary PIC, or an
 * Owner/Administrator. Enforced server-side; the UI merely mirrors it.
 */
export function canDeleteAttachment(actor: DeleteActor, target: DeleteTarget): boolean {
  if (actor.isAdministrator) return true;
  if (!actor.actorUserId) return false;
  if (target.uploadedByUserId && target.uploadedByUserId === actor.actorUserId) return true;
  if (target.assignedUserId && target.assignedUserId === actor.actorUserId) return true;
  return false;
}

/* ------------------------------- formatting ------------------------------ */

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Accept attribute for the file input (convenience only). */
export const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED_BY_EXTENSION)
  .map((e) => `.${e}`)
  .join(",");
