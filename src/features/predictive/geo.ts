// Geographic helpers for incident ↔ route matching.

const R_EARTH_KM = 6371;

const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Shortest distance (km) from a point to the segment origin→destination.
 * Uses a local equirectangular projection — accurate enough at city scale.
 */
export function distanceToSegmentKm(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  // Project to a local planar frame (km) centred on point A.
  const kx = (Math.cos(toRad(aLat)) * Math.PI * R_EARTH_KM) / 180;
  const ky = (Math.PI * R_EARTH_KM) / 180;
  const ax = 0;
  const ay = 0;
  const bx = (bLng - aLng) * kx;
  const by = (bLat - aLat) * ky;
  const px = (pLng - aLng) * kx;
  const py = (pLat - aLat) * ky;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
