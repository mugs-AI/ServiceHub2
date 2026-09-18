import { describe, expect, it } from "vitest";

import {
  appleMapsUrl,
  geoUri,
  googleMapsUrl,
  hasMapAction,
  isAndroidDevice,
  isAppleMapsDevice,
  mapChoicesForPoint,
  mapUrlForPoint,
  sharePayload,
  shareLocationUrl,
  validCoordinate,
  wazeUrl,
} from "@/lib/qne/service-jobs/attendance-map";

const validIn = {
  gpsResult: "ok" as const,
  latitude: 3.139,
  longitude: 101.6869,
  accuracy: 25,
};

const point = { latitude: 3.139, longitude: 101.6869 };

describe("on-site attendance map links", () => {
  it("selects Apple Maps for iPhone, iPad and touch-mode iPadOS", () => {
    expect(isAppleMapsDevice("Mozilla/5.0 (iPhone)", "iPhone", 5)).toBe(true);
    expect(isAppleMapsDevice("Mozilla/5.0 (iPad)", "iPad", 5)).toBe(true);
    expect(isAppleMapsDevice("Mozilla/5.0 (Macintosh)", "MacIntel", 5)).toBe(true);
    expect(isAppleMapsDevice("Mozilla/5.0 (Linux; Android 14)", "Linux armv8l", 5)).toBe(false);
  });

  it("detects Android devices for the geo: hand-off", () => {
    expect(isAndroidDevice("Mozilla/5.0 (Linux; Android 14)", "Linux armv8l")).toBe(true);
    expect(isAndroidDevice("Mozilla/5.0 (iPhone)", "iPhone")).toBe(false);
  });

  it("creates encoded Apple, Google, Waze and geo URLs", () => {
    expect(googleMapsUrl(point)).toBe(
      "https://www.google.com/maps/search/?api=1&query=3.139%2C101.6869",
    );
    expect(appleMapsUrl(point)).toBe("https://maps.apple.com/?q=3.139%2C101.6869");
    expect(wazeUrl(point)).toBe("https://waze.com/ul?ll=3.139%2C101.6869&navigate=yes");
    expect(geoUri(point)).toBe("geo:3.139,101.6869?q=3.139%2C101.6869");
    expect(shareLocationUrl(point)).toBe(googleMapsUrl(point));
    expect(mapUrlForPoint(validIn, true)).toBe(appleMapsUrl(point));
    expect(mapUrlForPoint(validIn, false)).toBe(googleMapsUrl(point));
  });

  it("allows both accepted captured outcomes, including zero coordinates", () => {
    const zero = { gpsResult: "low_accuracy", latitude: 0, longitude: 0, accuracy: 500 };
    expect(validCoordinate(zero)).toEqual({ latitude: 0, longitude: 0 });
    expect(hasMapAction(zero)).toBe(true);
    expect(
      mapChoicesForPoint(zero, { apple: false, android: false, canShare: false })?.[0].href,
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
      mapUrlForPoint({ gpsResult: null, latitude: null, longitude: null, accuracy: null }, false),
    ).toBeNull();
    expect(hasMapAction({ ...validIn, gpsResult: "permission_denied" })).toBe(false);
    expect(
      mapChoicesForPoint(
        { ...validIn, gpsResult: "unavailable" },
        {
          apple: true,
          android: true,
          canShare: true,
        },
      ),
    ).toBeNull();
    expect(sharePayload("Map In", { ...validIn, accuracy: -1 })).toBeNull();
  });
});

describe("cross-platform chooser destinations", () => {
  it("offers Google, Waze and copy everywhere, Apple only on Apple devices", () => {
    const plain = mapChoicesForPoint(validIn, { apple: false, android: false, canShare: false })!;
    expect(plain.map((c) => c.id)).toEqual(["google", "waze", "copy"]);

    const apple = mapChoicesForPoint(validIn, { apple: true, android: false, canShare: true })!;
    expect(apple.map((c) => c.id)).toEqual(["google", "waze", "apple", "share", "copy"]);
  });

  it("adds the Android geo: choice and the share sheet when available", () => {
    const android = mapChoicesForPoint(validIn, { apple: false, android: true, canShare: true })!;
    expect(android.map((c) => c.id)).toEqual(["google", "waze", "geo", "share", "copy"]);
    expect(android.find((c) => c.id === "geo")!.href.startsWith("geo:")).toBe(true);
    expect(android.find((c) => c.id === "share")!.kind).toBe("share");
    expect(android.find((c) => c.id === "copy")!.href.startsWith("https://")).toBe(true);
  });

  it("builds a human-readable share payload with a safe HTTPS URL", () => {
    expect(sharePayload("Map Out", validIn)).toEqual({
      title: "On-site attendance Clock Out location",
      text: "On-site attendance Clock Out location",
      url: googleMapsUrl(point),
    });
    expect(sharePayload("Map In", validIn)!.title).toContain("Clock In");
  });
});
