// WP2B — pure attachment policy evidence.
//
// These are the boundaries the server promises: size, count, total, the
// allow/deny matrix, blank-MIME handling for HEIC, filename sanitisation and
// the delete permission matrix.

import { describe, expect, it } from "vitest";

import {
  ACCEPT_ATTRIBUTE,
  FORCED_VISIBILITY,
  MAX_ACTIVE_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  canDeleteAttachment,
  effectiveMime,
  fileExtension,
  formatBytes,
  isBlockedMime,
  isPreviewableMime,
  sanitizeDisplayName,
  validateCandidate,
  validateQuota,
} from "./attachment-policy";

const ok = (name: string, type: string, size = 1024) => validateCandidate({ name, type, size });

describe("WP2B limits", () => {
  it("uses the approved hard limits", () => {
    expect(MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_ACTIVE_FILES).toBe(10);
    expect(MAX_TOTAL_BYTES).toBe(100 * 1024 * 1024);
    expect(FORCED_VISIBILITY).toBe("internal");
  });

  it("accepts a file exactly on the size limit and rejects one byte more", () => {
    expect(ok("photo.jpg", "image/jpeg", MAX_FILE_BYTES).ok).toBe(true);
    const over = ok("photo.jpg", "image/jpeg", MAX_FILE_BYTES + 1);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toContain("20 MB");
  });

  it("rejects an empty file", () => {
    expect(ok("photo.jpg", "image/jpeg", 0).ok).toBe(false);
  });
});

describe("WP2B allow / deny matrix", () => {
  const allowed: Array<[string, string]> = [
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["shot.png", "image/png"],
    ["shot.heic", "image/heic"],
    ["shot.heif", "image/heif"],
    ["shot.webp", "image/webp"],
    ["report.pdf", "application/pdf"],
    ["notes.txt", "text/plain"],
    ["server.log", "text/plain"],
    ["data.csv", "text/csv"],
    ["letter.doc", "application/msword"],
    ["letter.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["sheet.xls", "application/vnd.ms-excel"],
    ["sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["bundle.zip", "application/zip"],
  ];

  it.each(allowed)("accepts %s", (name, type) => {
    expect(ok(name, type).ok).toBe(true);
  });

  const denied: Array<[string, string]> = [
    ["setup.exe", "application/octet-stream"],
    ["installer.msi", "application/octet-stream"],
    ["run.bat", "text/plain"],
    ["script.sh", "text/plain"],
    ["macro.docm", "application/vnd.ms-word.document.macroEnabled.12"],
    ["macro.xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"],
    ["clip.mp4", "video/mp4"],
    ["clip.mov", "video/quicktime"],
    ["payload.js", "text/javascript"],
  ];

  it.each(denied)("rejects %s", (name, type) => {
    expect(ok(name, type).ok).toBe(false);
  });

  it("rejects a blocked extension hidden behind an allowed one", () => {
    expect(ok("report.exe.jpg", "image/jpeg").ok).toBe(false);
  });

  it("rejects an allowed extension carrying a video MIME type", () => {
    expect(ok("photo.jpg", "video/mp4").ok).toBe(false);
    expect(isBlockedMime("video/webm")).toBe(true);
  });

  it("rejects a MIME type that does not match the extension", () => {
    expect(ok("report.pdf", "image/png").ok).toBe(false);
  });

  it("rejects a file with no extension at all", () => {
    expect(ok("payload", "application/pdf").ok).toBe(false);
  });
});

describe("WP2B blank MIME handling", () => {
  it("derives a MIME type for HEIC when the browser sends none", () => {
    expect(effectiveMime({ name: "photo.heic", type: "", size: 10 })).toBe("image/heic");
    expect(ok("photo.heic", effectiveMime({ name: "photo.heic", type: "", size: 10 })).ok).toBe(
      true,
    );
  });

  it("derives a MIME type for .log and .csv when the browser sends none", () => {
    expect(effectiveMime({ name: "a.log", type: "", size: 10 })).toBeTruthy();
    expect(effectiveMime({ name: "a.csv", type: "", size: 10 })).toBeTruthy();
  });

  it("does not let a blank MIME rescue a blocked extension", () => {
    const mime = effectiveMime({ name: "setup.exe", type: "", size: 10 });
    expect(validateCandidate({ name: "setup.exe", type: mime, size: 10 }).ok).toBe(false);
  });
});

describe("WP2B filename safety", () => {
  it("strips directory components from a user-supplied name", () => {
    expect(sanitizeDisplayName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(sanitizeDisplayName("C:\\Users\\me\\photo.jpg")).toBe("photo.jpg");
  });

  it("keeps the extension usable after sanitisation", () => {
    expect(fileExtension("../../report.pdf")).toBe("pdf");
  });

  it("advertises only allowed extensions to the file picker", () => {
    expect(ACCEPT_ATTRIBUTE).toContain(".pdf");
    expect(ACCEPT_ATTRIBUTE).not.toContain(".exe");
    expect(ACCEPT_ATTRIBUTE).not.toContain(".mp4");
  });
});

describe("WP2B per-Job quota", () => {
  it("refuses the 11th active file", () => {
    expect(validateQuota({ activeCount: 9, activeBytes: 0 }, 10).ok).toBe(true);
    const full = validateQuota({ activeCount: MAX_ACTIVE_FILES, activeBytes: 0 }, 10);
    expect(full.ok).toBe(false);
  });

  it("refuses a file that would push the Job over the total", () => {
    const nearly = MAX_TOTAL_BYTES - 1024;
    expect(validateQuota({ activeCount: 1, activeBytes: nearly }, 1024).ok).toBe(true);
    expect(validateQuota({ activeCount: 1, activeBytes: nearly }, 1025).ok).toBe(false);
  });
});

describe("WP2B delete permission matrix", () => {
  const target = { uploadedByUserId: "u-uploader", assignedUserId: "u-pic" };

  it("allows the uploader", () => {
    expect(canDeleteAttachment({ actorUserId: "u-uploader", isAdministrator: false }, target)).toBe(
      true,
    );
  });

  it("allows the current Primary PIC", () => {
    expect(canDeleteAttachment({ actorUserId: "u-pic", isAdministrator: false }, target)).toBe(
      true,
    );
  });

  it("allows an Owner/Admin", () => {
    expect(canDeleteAttachment({ actorUserId: "u-other", isAdministrator: true }, target)).toBe(
      true,
    );
  });

  it("refuses an unrelated teammate", () => {
    expect(canDeleteAttachment({ actorUserId: "u-other", isAdministrator: false }, target)).toBe(
      false,
    );
  });

  it("refuses an unidentified actor", () => {
    expect(canDeleteAttachment({ actorUserId: null, isAdministrator: false }, target)).toBe(false);
  });
});

describe("WP2B presentation helpers", () => {
  it("marks images and PDF previewable, other formats not", () => {
    expect(isPreviewableMime("image/png")).toBe(true);
    expect(isPreviewableMime("application/pdf")).toBe(true);
    expect(isPreviewableMime("application/zip")).toBe(false);
  });

  it("formats byte counts for humans", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(2048)).toContain("KB");
  });
});
