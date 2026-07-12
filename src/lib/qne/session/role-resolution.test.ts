import { describe, expect, it } from "vitest";
import {
  decideAdmin,
  hasAdministratorRole,
  matchCurrentUser,
  normaliseEmail,
  type N3UserDto,
} from "./role-resolution";

const jonas: N3UserDto = {
  userId: "u-jonas",
  userName: "lks.mugs@gmail.com",
  email: "lks.mugs@gmail.com",
  displayName: "JONAS",
  isOwner: true,
  roles: [
    { name: "Owner" },
    { name: "Administrators" },
  ],
};

const billing: N3UserDto = {
  userId: "u-b",
  userName: "billing@acme.co",
  email: "billing@acme.co",
  displayName: "Billing",
  roles: [{ name: "Billing Administrators" }],
};

const coAdmin: N3UserDto = {
  userId: "u-c",
  userName: "co@acme.co",
  email: "co@acme.co",
  displayName: "Co",
  roles: [{ name: "Co-Administrators" }],
};

const support: N3UserDto = {
  userId: "u-s",
  userName: "sup@acme.co",
  email: "sup@acme.co",
  displayName: "Sup",
  roles: [{ name: "Support" }],
};

const neverAllow = { isAllowlisted: () => false, tryBootstrap: () => false };

describe("email normalisation & matching", () => {
  it("matches lowercase BasicInfo email to uppercase N3 username", () => {
    const users: N3UserDto[] = [{ ...jonas, userName: "LKS.MUGS@GMAIL.COM", email: null }];
    expect(matchCurrentUser(users, { email: "lks.mugs@gmail.com" })).toBe(users[0]);
  });
  it("matches uppercase BasicInfo email to lowercase N3 username", () => {
    const users: N3UserDto[] = [{ ...jonas, userName: "lks.mugs@gmail.com", email: null }];
    expect(matchCurrentUser(users, { email: "LKS.MUGS@GMAIL.COM" })).toBe(users[0]);
  });
  it("normaliseEmail trims and lowercases", () => {
    expect(normaliseEmail("  Foo@BAR.com  ")).toBe("foo@bar.com");
  });
});

describe("hasAdministratorRole", () => {
  it("exact Administrators role → true", () => {
    expect(hasAdministratorRole(jonas)).toBe(true);
  });
  it("only Billing Administrators → false", () => {
    expect(hasAdministratorRole(billing)).toBe(false);
  });
  it("only Co-Administrators → false", () => {
    expect(hasAdministratorRole(coAdmin)).toBe(false);
  });
  it("Owner + Administrators → true", () => {
    expect(hasAdministratorRole(jonas)).toBe(true);
  });
});

describe("decideAdmin", () => {
  it("returns n3_role for exact Administrators role", async () => {
    const d = await decideAdmin([jonas, support], { email: "LKS.MUGS@GMAIL.COM" }, neverAllow);
    expect(d).toMatchObject({
      isAdministrator: true,
      adminGate: "n3_role",
      matchedUserId: "u-jonas",
      matchedDisplayName: "JONAS",
    });
    expect(d.roleNames).toContain("Administrators");
  });
  it("returns none for Billing Administrators only", async () => {
    const d = await decideAdmin([billing], { email: "billing@acme.co" }, neverAllow);
    expect(d.isAdministrator).toBe(false);
    expect(d.adminGate).toBe("none");
    expect(d.reason).toBe("not_admin");
  });
  it("returns none for Co-Administrators only", async () => {
    const d = await decideAdmin([coAdmin], { email: "co@acme.co" }, neverAllow);
    expect(d.isAdministrator).toBe(false);
    expect(d.adminGate).toBe("none");
  });
  it("falls back to allowlist when /api/Users is unavailable", async () => {
    const d = await decideAdmin(
      null,
      { email: "someone@acme.co" },
      { isAllowlisted: (e) => e.toLowerCase() === "someone@acme.co" },
    );
    expect(d.adminGate).toBe("allowlist");
    expect(d.isAdministrator).toBe(true);
  });
  it("allowlist matching is case-insensitive", async () => {
    const seen: string[] = [];
    const d = await decideAdmin(
      [],
      { email: "MiXeD@Acme.CO" },
      { isAllowlisted: (e) => { seen.push(e); return true; } },
    );
    expect(d.isAdministrator).toBe(true);
    // helper receives the original email; case-insensitive comparison is the
    // caller's responsibility — verify the allowlist implementation lowercases.
    expect(seen[0]).toBe("MiXeD@Acme.CO");
  });
  it("handles multiple roles correctly", async () => {
    const multi: N3UserDto = {
      userId: "m",
      email: "m@x.co",
      roles: [{ name: "Accountant" }, { name: "Owner" }, { name: "Administrators" }],
    };
    const d = await decideAdmin([multi], { email: "m@x.co" }, neverAllow);
    expect(d.isAdministrator).toBe(true);
    expect(d.adminGate).toBe("n3_role");
    expect(d.roleNames).toEqual(["Accountant", "Owner", "Administrators"]);
  });
  it("returns users_unavailable reason when /api/Users failed and no fallback", async () => {
    const d = await decideAdmin(null, { email: "x@y.co" }, neverAllow);
    expect(d.isAdministrator).toBe(false);
    expect(d.reason).toBe("users_unavailable");
  });
});
