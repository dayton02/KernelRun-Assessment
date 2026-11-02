// Small vector + geometry helpers used across systems.

export interface Vec2 { x: number; y: number; }

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** perpendicular (rotate +90deg): perp((x,y)) = (-y, x) */
export const perp = (p: Vec2): Vec2 => ({ x: -p.y, y: p.x });

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

export interface AABB { x: number; y: number; w: number; h: number; }

export const aabbContainsX = (r: AABB, x: number): boolean =>
  x >= r.x && x <= r.x + r.w;

/**
 * Swept circle vs AABB. Returns time-of-impact in [0,1] and the contact
 * normal, or null if no hit over the motion `d`. Used for CCD against moving
 * window borders (DESIGN.md §3.5).
 */
export function sweptCircleAABB(
  p: Vec2, r: number, d: Vec2, box: AABB,
): { t: number; nx: number; ny: number } | null {
  // Expand the AABB by the circle radius (Minkowski) and ray-cast the center.
  const ex = { x: box.x - r, y: box.y - r, w: box.w + 2 * r, h: box.h + 2 * r };
  let tmin = 0;
  let tmax = 1;
  let nx = 0;
  let ny = 0;

  // X slab
  if (Math.abs(d.x) < 1e-9) {
    if (p.x < ex.x || p.x > ex.x + ex.w) return null;
  } else {
    const inv = 1 / d.x;
    let t1 = (ex.x - p.x) * inv;
    let t2 = (ex.x + ex.w - p.x) * inv;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) { tmin = t1; nx = sign; ny = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // Y slab
  if (Math.abs(d.y) < 1e-9) {
    if (p.y < ex.y || p.y > ex.y + ex.h) return null;
  } else {
    const inv = 1 / d.y;
    let t1 = (ex.y - p.y) * inv;
    let t2 = (ex.y + ex.h - p.y) * inv;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = sign; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  if (tmin < 0 || tmin > 1) return null;
  return { t: tmin, nx, ny };
}
