// WP1-V preview-auth safety proof.
//
// The Supabase browser client uses `brokeredPreviewStorage()` as its auth
// storage. These tests pin the security-relevant behaviour of that broker:
// production hosts never broker, only validated Lovable preview hosts inside a
// trusted editor frame do, tokens are only posted to trusted editor origins,
// replies from untrusted origins are ignored, project ids cannot be smuggled
// through user-controlled host segments, logout tombstones clear local copies,
// and a silent broker falls back to local storage.

import { afterEach, describe, expect, it, vi } from "vitest";

import { brokeredPreviewStorage } from "./previewAuthStorage";

type Posted = { msg: Record<string, unknown>; origin: string };

interface Harness {
  posted: Posted[];
  listeners: ((e: MessageEvent) => void)[];
  local: Record<string, string>;
}

function setup(host: string, opts: { framed?: boolean; ancestor?: string } = {}): Harness {
  const framed = opts.framed ?? true;
  const posted: Posted[] = [];
  const listeners: ((e: MessageEvent) => void)[] = [];
  const local: Record<string, string> = {};

  const localStorage = {
    getItem: (k: string) => (k in local ? local[k]! : null),
    setItem: (k: string, v: string) => {
      local[k] = v;
    },
    removeItem: (k: string) => {
      delete local[k];
    },
  };

  const parent = {
    postMessage: (msg: Record<string, unknown>, origin: string) => posted.push({ msg, origin }),
  };

  const win: Record<string, unknown> = {
    parent: framed ? parent : undefined,
    addEventListener: (_t: string, fn: (e: MessageEvent) => void) => listeners.push(fn),
    removeEventListener: (_t: string, fn: (e: MessageEvent) => void) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    localStorage,
  };
  if (framed) (win as { parent?: unknown }).parent = parent;
  else (win as { parent?: unknown }).parent = win;

  vi.stubGlobal("window", win);
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("location", {
    hostname: host,
    ancestorOrigins: opts.ancestor ? [opts.ancestor] : undefined,
  });
  vi.stubGlobal("document", { referrer: "" });

  return { posted, listeners, local };
}

function reply(h: Harness, origin: string, extra: Record<string, unknown> = {}) {
  const last = h.posted[h.posted.length - 1]!.msg;
  const event = {
    origin,
    data: {
      type: "lovable-preview-auth:result",
      requestId: last["requestId"],
      ok: true,
      ...extra,
    },
  } as unknown as MessageEvent;
  for (const fn of [...h.listeners]) fn(event);
}

const PROJECT = "9265adcd-acf6-4fdb-a766-3fc21310ee8f";
const KEY = "sb-yhzsrbwwhflelpxqbisu-auth-token";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("production hosts never broker", () => {
  it("returns plain localStorage on the published custom/app host", () => {
    setup("servicehub22.lovable.app");
    expect(brokeredPreviewStorage()).toBe(globalThis.localStorage);
  });

  it("returns plain localStorage on an unrelated production domain", () => {
    setup("servicehub.example.com", { ancestor: "https://evil.example" });
    expect(brokeredPreviewStorage()).toBe(globalThis.localStorage);
  });

  it("returns plain localStorage on a preview host that is not framed", () => {
    setup(`id-preview--${PROJECT}.lovable.app`, { framed: false });
    expect(brokeredPreviewStorage()).toBe(globalThis.localStorage);
  });

  it("ignores a project id smuggled through a user-controlled host label", () => {
    setup(`preview--evil-${PROJECT}.lovable.app`);
    expect(brokeredPreviewStorage()).toBe(globalThis.localStorage);
  });

  it("is inert during SSR", () => {
    vi.stubGlobal("window", undefined);
    expect(brokeredPreviewStorage()).toBeUndefined();
  });
});

describe("validated preview host inside the editor", () => {
  it("posts only to the validated editor ancestor and tags the project id", async () => {
    const h = setup(`id-preview--${PROJECT}.lovable.app`, { ancestor: "https://lovable.dev" });
    const storage = brokeredPreviewStorage() as Exclude<
      ReturnType<typeof brokeredPreviewStorage>,
      Storage | undefined
    >;
    expect(storage).not.toBe(globalThis.localStorage);

    const pending = storage!.setItem(KEY, "token-value");
    expect(h.posted).toHaveLength(1);
    expect(h.posted[0]!.origin).toBe("https://lovable.dev");
    expect(h.posted[0]!.msg["projectId"]).toBe(PROJECT);
    expect(h.posted.every((p) => p.origin !== "*")).toBe(true);
    reply(h, "https://lovable.dev");
    await pending;
    // The local copy is always written too, so a silent broker cannot lose the session.
    expect(h.local[KEY]).toBe("token-value");
  });

  it("never targets an untrusted ancestor origin", () => {
    const h = setup(`id-preview--${PROJECT}.lovable.app`, { ancestor: "https://evil.example" });
    const storage = brokeredPreviewStorage();
    void (storage as Storage).setItem(KEY, "token-value");
    expect(h.posted.map((p) => p.origin)).toEqual(["https://lovable.dev"]);
  });

  it("ignores replies from untrusted origins and falls back to local storage", async () => {
    vi.useFakeTimers();
    const h = setup(`id-preview--${PROJECT}.lovable.app`, { ancestor: "https://lovable.dev" });
    h.local[KEY] = "local-token";
    const storage = brokeredPreviewStorage() as Storage;
    const read = storage.getItem(KEY) as unknown as Promise<string | null>;
    reply(h, "https://evil.example", { value: "attacker-token" });
    await vi.advanceTimersByTimeAsync(3000);
    // first attempt times out, retry fires
    reply(h, "https://evil.example", { value: "attacker-token" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await read).toBe("local-token");
  });

  it("honours the logout tombstone by clearing the local copy", async () => {
    const h = setup(`id-preview--${PROJECT}.lovable.app`, { ancestor: "https://lovable.dev" });
    h.local[KEY] = "stale-token";
    const storage = brokeredPreviewStorage() as Storage;
    const read = storage.getItem(KEY) as unknown as Promise<string | null>;
    reply(h, "https://lovable.dev", { value: "" });
    expect(await read).toBeNull();
    expect(h.local[KEY]).toBeUndefined();
  });

  it("returns the brokered value when the trusted editor answers", async () => {
    const h = setup(`id-preview--${PROJECT}.lovable.app`, { ancestor: "https://lovable.dev" });
    const storage = brokeredPreviewStorage() as Storage;
    const read = storage.getItem(KEY) as unknown as Promise<string | null>;
    reply(h, "https://lovable.dev", { value: "editor-token" });
    expect(await read).toBe("editor-token");
  });

  it("falls back to the local copy when the broker stays silent", async () => {
    vi.useFakeTimers();
    const h = setup(`id-preview--${PROJECT}.lovable.app`, { ancestor: "https://lovable.dev" });
    h.local[KEY] = "local-token";
    const storage = brokeredPreviewStorage() as Storage;
    const read = storage.getItem(KEY) as unknown as Promise<string | null>;
    await vi.advanceTimersByTimeAsync(6000);
    expect(await read).toBe("local-token");
  });
});

describe("N3 authorization is unaffected by the broker", () => {
  it("brokers only the Supabase auth key namespace, never the N3 token key", async () => {
    const h = setup(`id-preview--${PROJECT}.lovable.app`, { ancestor: "https://lovable.dev" });
    const storage = brokeredPreviewStorage() as Storage;
    void storage.setItem(KEY, "token-value");
    // The N3 access token is written by src/lib/qne/tokens.ts straight to
    // window.localStorage and never passes through this storage adapter.
    globalThis.localStorage.setItem("qne_access_token", "n3-jwt");
    expect(h.posted.map((p) => p.msg["key"])).toEqual([KEY]);
    expect(h.local["qne_access_token"]).toBe("n3-jwt");
  });
});
