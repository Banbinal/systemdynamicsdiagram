/**
 * Map (lookup-table) interpolation: `linear`, `step`, `spline`.
 *
 * All interpolators use the same convention: outside the table's `[x0, xN]`
 * range we clamp to the endpoint y-value (no extrapolation). This matches what
 * users expect for piecewise empirical curves and makes natural cubic splines
 * safe at the boundary (where their second derivative is fixed to zero).
 *
 * Spline mode requires a precomputed `y2` second-derivative table; build one
 * with `precomputeSpline(xs, ys)` at compile time and store it on `MapData`.
 */

import type { MapData } from './program.js';

export function interpolateMap(map: MapData, x: number): number {
  switch (map.interpolation) {
    case 'linear':
      return interpLinear(map.xs, map.ys, x);
    case 'step':
      return interpStep(map.xs, map.ys, x);
    case 'spline':
      return interpSpline(map.xs, map.ys, map.y2!, x);
  }
}

/**
 * Largest index `i` such that `xs[i] <= x`, or `-1` if `x < xs[0]`.
 * Assumes `xs` is sorted ascending and non-empty.
 */
function bsearch(xs: Float64Array, x: number): number {
  if (x < xs[0]!) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  if (x >= xs[hi]!) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function interpLinear(xs: Float64Array, ys: Float64Array, x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (n === 1) return ys[0]!;
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  const i = bsearch(xs, x);
  const x0 = xs[i]!;
  const x1 = xs[i + 1]!;
  const y0 = ys[i]!;
  const y1 = ys[i + 1]!;
  const t = (x - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

export function interpStep(xs: Float64Array, ys: Float64Array, x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (x < xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  const i = bsearch(xs, x);
  return ys[i]!;
}

export function interpSpline(
  xs: Float64Array,
  ys: Float64Array,
  y2: Float64Array,
  x: number,
): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (n === 1) return ys[0]!;
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  const klo = bsearch(xs, x);
  const khi = klo + 1;
  const h = xs[khi]! - xs[klo]!;
  const a = (xs[khi]! - x) / h;
  const b = (x - xs[klo]!) / h;
  return (
    a * ys[klo]! +
    b * ys[khi]! +
    ((a * a * a - a) * y2[klo]! + (b * b * b - b) * y2[khi]!) * (h * h) / 6
  );
}

/**
 * Natural cubic spline second-derivative table.
 *
 * Numerical Recipes §3.3 — O(n) tridiagonal solve with `y2[0] = y2[n-1] = 0`
 * (natural boundary condition). Allocates and returns a fresh `Float64Array`
 * of length n; caller stores it on `MapData.y2`.
 */
export function precomputeSpline(xs: Float64Array, ys: Float64Array): Float64Array {
  const n = xs.length;
  const y2 = new Float64Array(n);
  if (n < 3) return y2;
  const u = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const sig = (xs[i]! - xs[i - 1]!) / (xs[i + 1]! - xs[i - 1]!);
    const p = sig * y2[i - 1]! + 2;
    y2[i] = (sig - 1) / p;
    let ui =
      (ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!) -
      (ys[i]! - ys[i - 1]!) / (xs[i]! - xs[i - 1]!);
    ui = (6 * ui / (xs[i + 1]! - xs[i - 1]!) - sig * u[i - 1]!) / p;
    u[i] = ui;
  }
  for (let k = n - 2; k >= 0; k--) {
    y2[k] = y2[k]! * y2[k + 1]! + u[k]!;
  }
  return y2;
}
