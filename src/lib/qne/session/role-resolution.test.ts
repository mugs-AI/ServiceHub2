import { describe, expect, it } from "vitest";
import {
  decideAdmin,
  hasAdministratorRole,
  isOwnerUser,
  matchCurrentUser,
  normaliseEmail,
  type N3UserDto,
  type UsersLoad,
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

const billingOwner: N3UserDto = {
  userId: "u-bo",
  userName: "bo@acme.co",
  email: "bo@acme.co",
  displayName: "BillingOwner",
  isOwner: true,
  roles: [{ name: "Billing Administrators" }],
};

const adminNotOwner: N3UserDto = {
  userId: "u-a",
  userName: "a@acme.co",
  email: "a@acme.co",
  displayName: "Admin",
  isOwner: false,
  roles: [{ name: "Administrators" }],
};

const support: N3UserDto = {
  userId: "u-s",
  userName: "sup@acme.co",
  email: "sup@acme.co",
  displayName: "Sup",
  isOwner: false,
  roles: [{ name: "Support" }],
};

const neverAllow = { isAllowlisted: () => false, tryBootstrap: () => false };
const ok = (users: N3UserDto[]): UsersLoad => ({ users, status: "ok" });

describe("email normalisation & matching", () => {
  it("matches lowercase identity to uppercase N3 username", () => {
    const users: N3UserDto[] = [{ ...jonas, userName: "LKS.MUGS@GMAIL.COM", email: null }];
    expect(matchCurrentUser(users, { email: "lks.mugs@gmail.com" })).toBe(users[0]);
  });
  it("matches uppercase identity to lowercase N3 username", () => {
    const users: N3UserDto[] = [{ ...jonas, userName: "lks.mugs@gmail.com", email: null }];
    expect(matchCurrentUser(users, { email: "LKS.MUGS@GMAIL.COM" })).toBe(users[0]);
  });
  it("normaliseEmail trims and lowercases", () => {
    expect(normaliseEmail("  Foo@BAR.com  ")).toBe("foo@bar.com");
  });
});

describe("isOwnerUser / hasAdministratorRole", () => {
  it("Owner=true → isOwnerUser true", () => {
    expect(isOwnerUser(jonas)).toBe(true);
  });
  it("Owner=false → isOwnerUser false, even with Administrators role", () => {
    expect(isOwnerUser(adminNotOwner)).toBe(false);
  });
  it("hasAdministratorRole is informational only", () => {
    expect(hasAdministratorRole(adminNotOwner)).toBe(true);
    expect(hasAdministratorRole(support)).toBe(false);
  });
});

describe("decideAdmin — Owner-based rule", () => {
  it("Owner=true → n3_owner", async () => {
    const d = await decideAdmin(ok([jonas, support]), { email: "LKS.MUGS@GMAIL.COM" }, neverAllow);
    expect(d).toMatchObject({
      isAdministrator: true,
      adminGate: "n3_owner",
      matchedUserId: "u-jonas",
      matchedDisplayName: "JONAS",
      isOwner: true,
      reason: "matched_owner",
    });
  });
  it("Owner=true even without Administrators role → n3_owner", async () => {
    const d = await decideAdmin(ok([billingOwner]), { email: "bo@acme.co" }, neverAllow);
    expect(d.isAdministrator).toBe(true);
    expect(d.adminGate).toBe("n3_owner");
    expect(d.reason).toBe("matched_owner");
  });
  it("Administrators role but not Owner → Normal User", async () => {
    const d = await decideAdmin(ok([adminNotOwner]), { email: "a@acme.co" }, neverAllow);
    expect(d.isAdministrator).toBe(false);
    expect(d.adminGate).toBe("none");
    expect(d.reason).toBe("matched_not_owner");
    expect(d.roleNames).toContain("Administrators");
  });
  it("Support user → Normal User", async () => {
    const d = await decideAdmin(ok([support]), { email: "sup@acme.co" }, neverAllow);
    expect(d.isAdministrator).toBe(false);
    expect(d.reason).toBe("matched_not_owner");
  });
  it("matches by userName when email missing", async () => {
    const d = await decideAdmin(ok([jonas]), { userName: "LKS.MUGS@GMAIL.COM" }, neverAllow);
    expect(d.isAdministrator).toBe(true);
    expect(d.matchedUserId).toBe("u-jonas");
  });
  it("matches by stable userId first", async () => {
    const d = await decideAdmin(ok([jonas]), { userId: "u-jonas" }, neverAllow);
    expect(d.isAdministrator).toBe(true);
  });
  it("identity missing → identity_missing", async () => {
    const d = await decideAdmin(ok([jonas]), {}, neverAllow);
    expect(d.isAdministrator).toBe(false);
    expect(d.reason).toBe("identity_missing");
  });
  it("no matching user → no_matching_user", async () => {
    const d = await decideAdmin(ok([support]), { email: "ghost@acme.co" }, neverAllow);
    expect(d.isAdministrator).toBe(false);
    expect(d.reason).toBe("no_matching_user");
  });
  it("/api/Users 401 without fallback → users_endpoint_unauthorized", async () => {
    const d = await decideAdmin(
      { users: null, status: "unauthorized" },
      { email: "x@y.co" },
      neverAllow,
    );
    expect(d.isAdministrator).toBe(false);
    expect(d.reason).toBe("users_endpoint_unauthorized");
  });
  it("/api/Users failed without fallback → users_endpoint_failed", async () => {
    const d = await decideAdmin({ users: null, status: "failed" }, { email: "x@y.co" }, neverAllow);
    expect(d.isAdministrator).toBe(false);
    expect(d.reason).toBe("users_endpoint_failed");
  });
  it("allowlist fallback fires when enabled", async () => {
    const d = await decideAdmin(
      { users: null, status: "failed" },
      { email: "someone@acme.co" },
      { isAllowlisted: (e) => e.toLowerCase() === "someone@acme.co" },
    );
    expect(d.adminGate).toBe("allowlist");
    expect(d.isAdministrator).toBe(true);
    expect(d.reason).toBe("allowlist_fallback");
  });
  it("inactive Owner is not admin", async () => {
    const inactive: N3UserDto = { ...jonas, isDisabled: true };
    const d = await decideAdmin(ok([inactive]), { email: "lks.mugs@gmail.com" }, neverAllow);
    expect(d.isAdministrator).toBe(false);
    expect(d.reason).toBe("matched_not_owner");
  });
});
