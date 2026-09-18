import {
  GPS_RESULT_CODES,
  isLocationCaptured,
} from "@/lib/qne/service-jobs/onsite-attendance";

import type { GpsResultCode } from "@/lib/qne/service-jobs/onsite-attendance";

export interface AttendanceMapPoint {
  gpsResult: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
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

export function mapUrlForPoint(point: AttendanceMapPoint, appleDevice: boolean): string | null {
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
  const coordinates = encodeURIComponent(`${point.latitude},${point.longitude}`);
  return appleDevice
    ? `https://maps.apple.com/?q=${coordinates}`
    : `https://www.google.com/maps/search/?api=1&query=${coordinates}`;
}