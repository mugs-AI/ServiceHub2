import { describe, expect, it } from "vitest";
import { openDynamicTab, closeDynamicTab, sanitizeDynamicTabs, INQUIRY_TAB } from "./dynamic-tabs";
const job = { kind: "job" as const, key: "job:abc-1", label: "SJ0001", href: "/jobs/abc-1" };
describe("Safe dynamic tabs", () => {
  it("reuses Inquiry while preserving Job tabs", () => {
    const tabs = openDynamicTab(openDynamicTab([job], INQUIRY_TAB), INQUIRY_TAB);
    expect(tabs).toEqual([job, INQUIRY_TAB]);
  });
  it("closing a visible Job preserves a hidden Inquiry while grants are unknown", () => {
    const raw = [job, INQUIRY_TAB];
    expect(closeDynamicTab(raw, job.key, null)).toEqual([INQUIRY_TAB]);
    expect(closeDynamicTab(raw, job.key, false)).toEqual([]);
    expect(closeDynamicTab(raw, INQUIRY_TAB.key, true)).toEqual([job]);
    expect(raw).toEqual([job, INQUIRY_TAB]);
  });
  it("rejects foreign URLs, mismatched keys and invalid job paths", () => {
    expect(
      sanitizeDynamicTabs(
        [
          job,
          INQUIRY_TAB,
          { ...job, href: "https://bad.invalid/jobs/abc-1" },
          { ...job, key: "job:other" },
          { ...job, href: "/jobs/abc-1/../../settings" },
          { ...job, key: "job:new", href: "/jobs/new" },
        ],
        true,
      ),
    ).toEqual([job, INQUIRY_TAB]);
    expect(sanitizeDynamicTabs("bad", true)).toEqual([]);
  });
  it("removes Inquiry when access is denied and bounds labels", () => {
    expect(sanitizeDynamicTabs([job, INQUIRY_TAB], false)).toEqual([job]);
    expect(
      sanitizeDynamicTabs([{ ...job, label: "A".repeat(200) }], true)[0].label.length,
    ).toBeLessThanOrEqual(100);
  });
});
