// WP2C-02 — pure helpers for the cross-platform map app chooser.
//
// Validation happens once here: a map action only exists for a stored,
// server-authorised captured point. Nothing in this module talks to the
// network, a third-party SDK or an API key.

import { GPS_RESULT_CODES, isLocationCaptured } from "@/lib/qne/service-jobs/onsite-attendance";

import type { GpsResultCode } from "@/lib/qne/service-jobs/onsite-attendance";

export interface AttendanceMapPoint {
  gpsResult: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
}

export interface ValidCoordinate {
  latitude: number;
  longitude: number;
}

export interface MapDevice {
  apple: boolean;
  android: boolean;
  canShare: boolean;
}

export type MapChoiceKind = "link" | "share" | "copy";

export interface MapChoice {
  id: "google" | "waze" | "apple" | "geo" | "share" | "copy";
  label: string;
  kind: MapChoiceKind;
  /** Present for link choices and for the value copied / shared. */
  href: string;
}

export function isAppleMapsDevice(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): boolean {
  return (
    /iPhone|iPad|iPod/i.test(userAgent) ||
    /^iP/.test(platform) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  );
}

export function isAndroidDevice(userAgent: string, platform: string): boolean {
  return /Android/i.test(userAgent) || /Android/i.test(platform);
}

/** The single validation gate: null unless this is a stored captured point. */
export function validCoordinate(point: AttendanceMapPoint): ValidCoordinate | null {
  if (!point.gpsResult || !(GPS_RESULT_CODES as readonly string[]).includes(point.gpsResult)) {
    return null;
  }
  if (
    !isLocationCaptured({
      gps_result: point.gpsResult as GpsResultCode,
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy: point.accuracy,
    })
  ) {
    return null;
  }
  return { latitude: point.latitude as number, longitude: point.longitude as number };
}

export function hasMapAction(point: AttendanceMapPoint): boolean {
  return validCoordinate(point) !== null;
}

const pair = (c: ValidCoordinate) => `${c.latitude},${c.longitude}`;

export function googleMapsUrl(c: ValidCoordinate): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pair(c))}`;
}

export function appleMapsUrl(c: ValidCoordinate): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(pair(c))}`;
}

export function wazeUrl(c: ValidCoordinate): string {
  return `https://waze.com/ul?ll=${encodeURIComponent(pair(c))}&navigate=yes`;
}

/**
 * Android standards URI. Android — not the browser — decides which installed
 * apps can handle it; we never claim to discover installed apps ourselves.
 */
export function geoUri(c: ValidCoordinate): string {
  return `geo:${pair(c)}?q=${encodeURIComponent(pair(c))}`;
}

/** Safe HTTPS location URL used for the OS share sheet and Copy Location Link. */
export function shareLocationUrl(c: ValidCoordinate): string {
  return googleMapsUrl(c);
}

/** Destinations offered by the chooser for one validated point. */
export function mapChoicesForPoint(
  point: AttendanceMapPoint,
  device: MapDevice,
): MapChoice[] | null {
  const c = validCoordinate(point);
  if (!c) return null;
  const choices: MapChoice[] = [
    { id: "google", label: "Google Maps", kind: "link", href: googleMapsUrl(c) },
    { id: "waze", label: "Waze", kind: "link", href: wazeUrl(c) },
  ];
  if (device.apple) {
    choices.push({ id: "apple", label: "Apple Maps", kind: "link", href: appleMapsUrl(c) });
  }
  if (device.android) {
    choices.push({ id: "geo", label: "Other Maps", kind: "link", href: geoUri(c) });
  }
  if (device.canShare) {
    choices.push({
      id: "share",
      label: "Share / More Apps",
      kind: "share",
      href: shareLocationUrl(c),
    });
  }
  choices.push({
    id: "copy",
    label: "Copy Location Link",
    kind: "copy",
    href: shareLocationUrl(c),
  });
  return choices;
}

/** Human-readable payload for the Web Share API. */
export function sharePayload(
  label: "Map In" | "Map Out",
  point: AttendanceMapPoint,
): { title: string; text: string; url: string } | null {
  const c = validCoordinate(point);
  if (!c) return null;
  const moment = label === "Map In" ? "Clock In" : "Clock Out";
  return {
    title: `On-site attendance ${moment} location`,
    text: `On-site attendance ${moment} location`,
    url: shareLocationUrl(c),
  };
}

/** Back-compat single-destination URL (Apple device vs everyone else). */
export function mapUrlForPoint(point: AttendanceMapPoint, appleDevice: boolean): string | null {
  const c = validCoordinate(point);
  if (!c) return null;
  return appleDevice ? appleMapsUrl(c) : googleMapsUrl(c);
}
