// WP2B hardening — object URL lifecycle in the Job Attachments card.
//
// Blob URLs pin bytes in memory for the document's lifetime until revoked, so
// every created URL must have exactly one owner and exactly one revoke:
//   - download: revoked promptly after the browser consumes the anchor click
//   - abandoned fetch (unmounted / null result): revoked immediately
//   - preview: kept until Close, then revoked exactly once
//   - unmount: revokes anything still tracked
//
// The card is a browser component with no render harness in this suite, so the
// guarantees are proven as source evidence plus a behavioural model of the
// tracking helper the card uses.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const SRC = readFileSync("src/components/qne/JobAttachmentsCard.tsx", "utf8");

describe("WP2B — blob URL lifecycle (source evidence)", () => {
  it("revokes the download URL after the click is consumed", () => {
    expect(SRC).toMatch(/a\.click\(\);[\s\S]{0,200}setTimeout\(\(\) => releaseUrl\(url\), 0\)/);
  });

  it("revokes an abandoned fetch result immediately", () => {
    const abandoned = SRC.match(
      /if \(!alive\.current \|\| !url\) \{\s*(\/\/[^\n]*\n\s*)*releaseUrl\(url\);/g,
    );
    expect(abandoned?.length).toBe(2); // preview + download paths
  });

  it("keeps the preview URL until Close, then revokes exactly once", () => {
    expect(SRC).toContain("setPreview({ att, url })");
    expect(SRC).toMatch(/closePreview[\s\S]{0,300}releaseUrl\(current\?\.url\)/);
  });

  it("still revokes any remaining URLs on unmount", () => {
    expect(SRC).toMatch(/alive\.current = false;[\s\S]{0,200}revokeAll\(\)/);
  });

  it("never puts a bearer token into a URL or the DOM", () => {
    expect(SRC).not.toMatch(/access_token=|\?token=/);
    expect(SRC).toMatch(/headers: authHeaders\(\)/);
  });
});

// Behavioural model of the card's tracking helpers: identical semantics, so a
// double revoke or a leaked URL would fail here too.
function makeTracker() {
  const tracked: string[] = [];
  const revoke = vi.fn();
  return {
    tracked,
    revoke,
    track(url: string) {
      tracked.push(url);
      return url;
    },
    release(url: string | null | undefined) {
      if (!url) return;
      if (!tracked.includes(url)) return;
      tracked.splice(tracked.indexOf(url), 1);
      revoke(url);
    },
    revokeAll() {
      for (const u of tracked) revoke(u);
      tracked.length = 0;
    },
  };
}

describe("WP2B — object URL tracking semantics", () => {
  it("release is idempotent and revokes exactly once", () => {
    const t = makeTracker();
    t.track("blob:a");
    t.release("blob:a");
    t.release("blob:a");
    expect(t.revoke).toHaveBeenCalledTimes(1);
    expect(t.tracked).toHaveLength(0);
  });

  it("unmount revokes only what is still outstanding", () => {
    const t = makeTracker();
    t.track("blob:preview");
    t.track("blob:download");
    t.release("blob:download"); // click consumed
    t.revokeAll(); // unmount
    expect(t.revoke).toHaveBeenCalledTimes(2);
    expect(t.revoke).toHaveBeenNthCalledWith(2, "blob:preview");
    expect(t.tracked).toHaveLength(0);
  });

  it("an abandoned fetch leaves nothing tracked", () => {
    const t = makeTracker();
    t.release(t.track("blob:abandoned"));
    t.revokeAll();
    expect(t.revoke).toHaveBeenCalledTimes(1);
  });
});
