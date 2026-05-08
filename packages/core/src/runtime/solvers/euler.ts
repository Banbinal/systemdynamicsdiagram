/**
 * Forward Euler integrator.
 *
 *   y(t + dt) = y(t) + dt · f(t, y(t))
 *
 * First-order accurate (global error O(dt)). Useful as a sanity baseline and
 * for very small dt; not recommended for stiff or oscillatory systems.
 *
 * Allocation-free: writes the derivative into `scratch.k1`, then accumulates
 * back into `state` in place.
 */

import type { Solver, StepContext } from '../solver.js';

export const EulerSolver: Solver = {
  name: 'euler',
  step(ctx: StepContext): void {
    const { t, dt, state, derivs, scratch } = ctx;
    const k1 = scratch.k1;
    derivs(t, state, k1);
    const n = state.length;
    for (let i = 0; i < n; i++) {
      state[i] = state[i]! + dt * k1[i]!;
    }
  },
};
