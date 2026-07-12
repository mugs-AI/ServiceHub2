
# Investigation: N3 Role Membership Availability

**Scope:** read-only inspection of the official N3 OpenAPI (`platform-v1`) already referenced by this project, plus the existing same-origin proxy behaviour. **No code changes proposed.**

Note on runtime inspection: I attempted to call `/api/CompanyProfile/BasicInfo` and `/api/Users` through the live proxy from the current preview viewer, but that viewer has no `qne_access_token` in `localStorage` (only `__lovable_session` / `__lovable_anonymous_id`) — the authenticated `lks.mugs@gmail.com` session is in the other viewer, which did not respond in time. Because `/api/session/me` exposes diagnostics only when `isAdministrator === true`, the chicken-and-egg means we can't yet see *why* the current user resolves as Normal. Findings below are therefore based on the authoritative OpenAPI spec at `https://openapi.account.qne.cloud/doc/platform-v1.json`.

---

### 1. Does `GET /api/user` include role membership?

**NO.** There is no `/api/user` (singular) operation in `platform-v1`. Verified endpoint list containing the string `user`:

- `GET /api/Users` — `Users_GetUsers_GET` (list, returns `UserDtoIEnumerableApiResponse`)
- `GET /api/Users/{id}` — `Users_GetById_GET`
- `GET /api/Users/Lookup`, `/SimpleLookup`, `/users-in-company`, `/GetAccountants`, `/GetSupports`
- `POST /api/Users/AttachRole`, `/DetachRole`, `/Invite`, `/Deactivate`, …
- `GET/POST /api/UserData`, `/api/UserDefaultSettings*`, `/api/UserTenantData`

No `/api/user`, `/api/users/me`, `/api/users/current`, or `/api/me` operation exists.

### 2. JSON structure (from `UserDto` schema in `platform-v1.json`)

```
{
  "userId": "...",
  "userName": "...",
  "email": "...",
  "displayName": "...",
  "pictureUrl": "...",
  "isOwner": true,
  "isSupport": false,
  "isAccountant": false,
  "phoneNumber": "...",
  "roles": [
    { "id": "...", "name": "...", "displayName": "...", "isSystemRole": true }
  ]
}
```

Envelope: `UserDtoIEnumerableApiResponse` (`ApiResponse<IEnumerable<UserDto>>`), unwrap `data`.

### 3. Exact field path for role names

`data[].roles[].name` (on `GET /api/Users`) — equivalently `UserDto.roles[].name` (`RoleDto.name`, required, max 100 chars).

### 4. Does `lks.mugs@gmail.com` appear inside the role-carrying response?

**Cannot be confirmed from this session** — the authenticated viewer did not respond, so a live `GET /api/Users` dump is not available. This is exactly the value that `/api/session/me → diagnostics.matchedN3UserId / matchedDisplayName / reason` is designed to reveal, but those are gated to administrators only.

### 5. Does the returned data contain `Administrators` / `Owner`?

**Cannot be confirmed** for the same reason as #4. `RoleDto.name` is the field to check; ServiceHub's `hasAdministratorRole()` does an exact, case-insensitive match on the literal string `"Administrators"` (see `src/lib/qne/session/role-resolution.ts`).

### 6. Alternative documented endpoints exposing roles / permissions

Within `platform-v1` only these operations touch role data:

- `GET /api/Users` — includes `roles[]` per user (as above).
- `GET /api/Users/{id}` — same shape, single user.
- `POST /api/Users/AttachRole` (`UserRoleLinkModel`) — mutation only.
- `POST /api/Users/DetachRole` (`UserRoleLinkModel`) — mutation only.

There is **no** dedicated `/api/Roles`, `/api/Permissions`, `/api/UserRoles`, or "current user roles" endpoint in `platform-v1`. Other scopes (`gl-v1`, `sales-v1`, `purchase-v1`, `stock-v1`, `pos-v1`, `einvoice-v1`, `integration-v1`, `bir-v1`, `reports-v1`) are business-domain scopes and, per the Development Brief, do not host identity/role endpoints.

### 7. Statement

Role **membership** is exposed — via `GET /api/Users` (`UserDto.roles[].name`). What is *not* exposed by the public N3 OpenAPI is a dedicated "current authenticated user" endpoint; the caller must self-identify from `BasicInfo` (or JWT claims) and match against the `/api/Users` list.

### 8. Recommendation

**A. Administrator detection should use official N3 role data.**

The public OpenAPI does expose role membership on `UserDto.roles[].name`, which is exactly what the existing `role-resolution.ts` already consumes. Given `lks.mugs@gmail.com` is a real `Owner` + `Administrators` user in the N3 Web UI but ServiceHub shows "Normal user", the most likely causes are operational, not spec gaps:

- The `/api/Users` call is failing for this session (401/403/empty envelope) — `decideAdmin` then returns `reason: "users_unavailable"` and falls through to the allowlist.
- `BasicInfo` for this user surfaces a `userName`/`email` that doesn't match any `UserDto.email` / `UserDto.userName` after normalisation (edge cases: whitespace, different casing paths, or `email: null` on the matching `UserDto` with a non-email `userName`).
- `isUserActive(matched)` false-negatives on a tenant that uses a non-standard active/disabled field name.

The allowlist should remain **only** as the documented fallback it already is. To make the root cause visible without another investigation round, consider (in a future change, not now) surfacing `adminGate` + `reason` + `diagnostics` from `/api/session/me` to any authenticated user, not just administrators — that alone would let us tell #4/#5 immediately from the browser.

---

**No files modified. No patches produced. Report only.**
