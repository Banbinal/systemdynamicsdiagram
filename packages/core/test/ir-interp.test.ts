/**
 * Map interpolation: linear, step, and natural cubic spline.
 *
 * The boundary contract is "clamp to endpoints" (no extrapolation), and the
 * spline must agree with linear on its two endpoints by construction.
 */

import { describe, expect, it } from 'vitest';

import {
  interpLinear,
  interpStep,
  interpSpline,
  precomputeSpline,
  interpolateMap,
} from '../src/ir/interp.js';
import type { MapData } from '../src/ir/program.js';

const xs = new Float64Array([0, 1, 2, 3, 4]);
const ys = new Float64Array([0, 1, 4, 9, 16]); // y = x^2

describe('interp — linear', () => {
  it('returns endpoint y for x at the lower boundary', () => {
    expect(interpLinear(xs, ys, 0)).toBe(0);
  });
  it('returns endpoint y for x at the upper boundary', () => {
    expect(interpLinear(xs, ys, 4)).toBe(16);
  });
  it('clamps below the lower boundary', () => {
    expect(interpLinear(xs, ys, -10)).toBe(0);
  });
  it('clamps above the upper boundary', () => {
    expect(interpLinear(xs, ys, 100)).toBe(16);
  });
  it('linearly interpolates at midpoints', () => {
    expect(interpLinear(xs, ys, 0.5)).toBe(0.5); // halfway between (0,0) and (1,1)
    expect(interpLinear(xs, ys, 1.5)).toBe(2.5); // halfway between (1,1) and (2,4)
    // Between (2,4) and (3,9), t = 0.25 → y = 4 + 0.25 * 5 = 5.25
    expect(interpLinear(xs, ys, 2.25)).toBeCloseTo(5.25, 12);
    expect(interpLinear(xs, ys, 2.5)).toBe(6.5);
  });
  it('handles a single-point table', () => {
    expect(interpLinear(new Float64Array([3]), new Float64Array([7]), 999)).toBe(7);
  });
});

describe('interp — step', () => {
  it('clamps below the first xs to ys[0]', () => {
    expect(interpStep(xs, ys, -5)).toBe(0);
  });
  it('returns the y for the largest x ≤ input', () => {
    expect(interpStep(xs, ys, 0)).toBe(0);
    expect(interpStep(xs, ys, 0.999)).toBe(0);
    expect(interpStep(xs, ys, 1)).toBe(1);
    expect(interpStep(xs, ys, 1.999)).toBe(1);
    expect(interpStep(xs, ys, 2)).toBe(4);
    expect(interpStep(xs, ys, 3.7)).toBe(9);
  });
  it('clamps above the last x to ys[n-1]', () => {
    expect(interpStep(xs, ys, 100)).toBe(16);
  });
});

describe('interp — natural cubic spline', () => {
  it('matches the data points exactly at xs[i]', () => {
    const y2 = precomputeSpline(xs, ys);
    for (let i = 0; i < xs.length; i++) {
      expect(interpSpline(xs, ys, y2, xs[i]!)).toBeCloseTo(ys[i]!, 12);
    }
  });
  it('clamps outside the table range', () => {
    const y2 = precomputeSpline(xs, ys);
    expect(interpSpline(xs, ys, y2, -1)).toBe(ys[0]!);
    expect(interpSpline(xs, ys, y2, 100)).toBe(ys[xs.length - 1]!);
  });
  it('approximates a smooth function with sub-percent error', () => {
    // Sample y = sin(x) on [0, π] at 11 points; spline must be close.
    const N = 11;
    const sxs = new Float64Array(N);
    const sys = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      sxs[i] = (i * Math.PI) / (N - 1);
      sys[i] = Math.sin(sxs[i]!);
    }
    const y2 = precomputeSpline(sxs, sys);
    // Sample at intermediate points and assert max error < 1e-3.
    let maxErr = 0;
    for (let i = 0; i < 100; i++) {
      const x = (i * Math.PI) / 99;
      const yhat = interpSpline(sxs, sys, y2, x);
      maxErr = Math.max(maxErr, Math.abs(yhat - Math.sin(x)));
    }
    expect(maxErr).toBeLessThan(1e-3);
  });
  it('produces zero second derivative at the natural BC endpoints', () => {
    const y2 = precomputeSpline(xs, ys);
    expect(y2[0]).toBe(0);
    expect(y2[xs.length - 1]).toBe(0);
  });
});

describe('interpolateMap dispatch', () => {
  function mkMap(interp: 'linear' | 'step' | 'spline'): MapData {
    if (interp === 'spline') {
      return {
        id: 0,
        fqn: 'M',
        interpolation: 'spline',
        xs,
        ys,
        y2: precomputeSpline(xs, ys),
      };
    }
    return {
      id: 0,
      fqn: 'M',
      interpolation: interp,
      xs,
      ys,
    };
  }

  it('dispatches to the correct interpolator', () => {
    expect(interpolateMap(mkMap('linear'), 0.5)).toBe(0.5);
    expect(interpolateMap(mkMap('step'), 0.5)).toBe(0);
    expect(interpolateMap(mkMap('spline'), 1)).toBeCloseTo(1, 12);
  });
});
