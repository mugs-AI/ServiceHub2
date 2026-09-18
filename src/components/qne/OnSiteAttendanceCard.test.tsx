import { describe, expect, it } from "vitest";

import { isAppleMapsDevice, mapUrlForPoint } from "@/lib/qne/service-jobs/attendance-map";

const validIn = {
  gpsResult: "ok" as const,
  latitude: 3.139,
  longitude: 101.6869,
  accuracy: 25,
};

describe("on-site attendance map links", () => {
  it("selects Apple Maps for iPhone, iPad and touch-mode iPadOS", () => {
    expect(isAppleMapsDevice("Mozilla/5.0 (iPhone)", "iPhone", 5)).toBe(true);
    expect(isAppleMapsDevice("Mozilla/5.0 (iPad)", "iPad", 5)).toBe(true);
    expect(isAppleMapsDevice("Mozilla/5.0 (Macintosh)", "MacIntel", 5)).toBe(true);
    expect(isAppleMapsDevice("Mozilla/5.0 (Linux; Android 14)", "Linux armv8l", 5)).toBe(false);
  });

  it("creates encoded Apple and Google universal URLs", () => {
    expect(mapUrlForPoint(validIn, true)).toBe(
      "https://maps.apple.com/?q=3.139%2C101.6869",
    );
    expect(mapUrlForPoint(validIn, false)).toBe(
      "https://www.google.com/maps/search/?api=1&query=3.139%2C101.6869",
    );
  });

  it("allows both accepted captured outcomes, including zero coordinates", () => {
    expect(
      mapUrlForPoint(
        { gpsResult: "low_accuracy", latitude: 0, longitude: 0, accuracy: 500 },
        false,
      ),
    ).toContain("query=0%2C0");
  });

  it("rejects missing, invalid, exception and non-captured evidence", () => {
    expect(mapUrlForPoint({ ...validIn, gpsResult: "timeout" }, false)).toBeNull();
    expect(mapUrlForPoint({ ...validIn, latitude: 91 }, false)).toBeNull();
    expect(mapUrlForPoint({ ...validIn, longitude: -181 }, false)).toBeNull();
    expect(mapUrlForPoint({ ...validIn, latitude: Number.NaN }, false)).toBeNull();
    expect(mapUrlForPoint({ ...validIn, longitude: Number.POSITIVE_INFINITY }, false)).toBeNull();
    expect(mapUrlForPoint({ ...validIn, accuracy: null }, false)).toBeNull();
    expect(
      mapUrlForPoint(
        { gpsResult: null, latitude: null, longitude: null, accuracy: null },
        false,
      ),
    ).toBeNull();
  });
});