import { describe, expect, it } from "vitest";

import {
  CALLBACK_PATH,
  GOOGLE_DRIVE_FOLDER_MIME,
  GOOGLE_DRIVE_SCOPE,
  NOT_CONNECTED,
  redirectUriFor,
  sanitizeFolderName,
  toPublicConnection,
  validateFolderMeta,
} from "./google-drive";

describe("WP2A scope and redirect", () => {
  it("requests only drive.file", () => {
    expect(GOOGLE_DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
  });

  it("builds the deterministic callback URI", () => {
    expect(redirectUriFor("https://servicehub22.lovable.app/")).toBe(
      `https://servicehub22.lovable.app${CALLBACK_PATH}`,
    );
  });
});

describe("validateFolderMeta", () => {
  const base = {
    id: "F1",
    name: "Software ServiceHub",
    mimeType: GOOGLE_DRIVE_FOLDER_MIME,
    trashed: false,
    capabilities: { canAddChildren: true, canListChildren: true },
  };

  it("accepts a usable My Drive folder", () => {
    const r = validateFolderMeta(base);
    expect(r.ok).toBe(true);
    expect(r.folder).toEqual({
      id: "F1",
      name: "Software ServiceHub",
      driveId: null,
      driveContext: "my_drive",
    });
  });

  it("classifies a Shared Drive folder", () => {
    const r = validateFolderMeta({ ...base, driveId: "SD9" });
    expect(r.folder?.driveContext).toBe("shared_drive");
    expect(r.folder?.driveId).toBe("SD9");
  });

  it("rejects a file, trashed folder, read-only folder and missing metadata", () => {
    expect(validateFolderMeta({ ...base, mimeType: "application/pdf" }).ok).toBe(false);
    expect(validateFolderMeta({ ...base, trashed: true }).ok).toBe(false);
    expect(
      validateFolderMeta({ ...base, capabilities: { canAddChildren: false } }).ok,
    ).toBe(false);
    expect(validateFolderMeta(null).ok).toBe(false);
    const bad = validateFolderMeta(null);
    expect(bad.recovery).toBeTruthy();
  });
});

describe("sanitizeFolderName", () => {
  it("defaults, trims and caps", () => {
    expect(sanitizeFolderName("")).toBe("Software ServiceHub");
    expect(sanitizeFolderName("  A\nB  ")).toBe("A B");
    expect(sanitizeFolderName("x".repeat(500)).length).toBe(120);
  });
});

describe("toPublicConnection", () => {
  it("never leaks secret columns", () => {
    const pub = toPublicConnection({
      status: "connected",
      google_account_email: "ops@tct.com",
      refresh_token_ciphertext: "v1.aaa.bbb",
      access_token_ciphertext: "v1.ccc.ddd",
      root_folder_id: "F1",
      sharing_policy: "restricted",
    });
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain("v1.aaa.bbb");
    expect(serialized).not.toContain("v1.ccc.ddd");
    expect(Object.keys(pub)).not.toContain("refresh_token_ciphertext");
    expect(pub.accountEmail).toBe("ops@tct.com");
  });

  it("falls back to a not-connected shape", () => {
    expect(toPublicConnection(null)).toEqual(NOT_CONNECTED);
  });
});
