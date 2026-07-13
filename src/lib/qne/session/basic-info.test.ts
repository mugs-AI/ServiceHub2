import { describe, expect, it } from "vitest";
import { normalizeBasicInfo } from "./basic-info";

describe("normalizeBasicInfo", () => {
  it("picks camelCase email + userName + tenantCode", () => {
    const n = normalizeBasicInfo({
      companyName: "Acme",
      tenantCode: "ACME",
      email: "user@acme.co",
      userName: "user@acme.co",
      displayName: "The User",
    });
    expect(n).toMatchObject({
      companyName: "Acme",
      tenantCode: "ACME",
      email: "user@acme.co",
      userName: "user@acme.co",
      displayName: "The User",
      primaryUserIdentifier: "user@acme.co",
    });
  });

  it("picks PascalCase fields case-insensitively", () => {
    const n = normalizeBasicInfo({
      CompanyName: "Acme",
      TenantCode: "ACME",
      Email: "LKS.MUGS@GMAIL.COM",
      DisplayName: "JONAS",
    });
    expect(n.companyName).toBe("Acme");
    expect(n.tenantCode).toBe("ACME");
    expect(n.email).toBe("LKS.MUGS@GMAIL.COM");
    expect(n.displayName).toBe("JONAS");
    expect(n.primaryUserIdentifier).toBe("LKS.MUGS@GMAIL.COM");
  });

  it("falls back to userName when email is missing", () => {
    const n = normalizeBasicInfo({
      tenantCode: "ACME",
      userName: "lks.mugs@gmail.com",
    });
    expect(n.email).toBeNull();
    expect(n.userName).toBe("lks.mugs@gmail.com");
    expect(n.primaryUserIdentifier).toBe("lks.mugs@gmail.com");
  });

  it("prefers stable userId over email/userName", () => {
    const n = normalizeBasicInfo({
      userId: "u-123",
      email: "a@b.co",
      userName: "a@b.co",
      tenantCode: "T",
    });
    expect(n.primaryUserIdentifier).toBe("u-123");
  });

  it("returns null primary identifier when every user field is missing", () => {
    const n = normalizeBasicInfo({
      tenantCode: "ACME",
      companyName: "Acme",
    });
    expect(n.primaryUserIdentifier).toBeNull();
    expect(n.email).toBeNull();
    expect(n.userName).toBeNull();
  });

  it("never promotes tenantCode or companyName to a user identifier", () => {
    const n = normalizeBasicInfo({
      tenantCode: "ACME",
      companyName: "Acme",
      // Malicious/broken payload where userName echoes the tenant code.
      userName: "ACME",
      email: "acme", // matches companyName case-insensitively
    });
    expect(n.userName).toBeNull();
    expect(n.email).toBeNull();
    expect(n.primaryUserIdentifier).toBeNull();
  });

  it("trims whitespace and handles empty/invalid inputs", () => {
    expect(normalizeBasicInfo(null).primaryUserIdentifier).toBeNull();
    expect(normalizeBasicInfo("bogus").primaryUserIdentifier).toBeNull();
    const n = normalizeBasicInfo({ email: "  a@b.co  " });
    expect(n.email).toBe("a@b.co");
  });

  it("recognises loginName as userName", () => {
    const n = normalizeBasicInfo({ loginName: "lks.mugs@gmail.com" });
    expect(n.userName).toBe("lks.mugs@gmail.com");
    expect(n.primaryUserIdentifier).toBe("lks.mugs@gmail.com");
  });
});
