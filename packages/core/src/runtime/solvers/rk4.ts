/**
 * Classic four-stage Runge-Kutta integrator.
 *
 *   k1 = f(t,        y)
 *   k2 = f(t + dt/2, y + k1 · dt/2)
 *   k3 = f(t + dt/2, y + k2 · dt/2)
 *   k4 = f(t + dt,   y + k3 · dt)
 *   y(t+dt) = y + (dt/6) · (k1 + 2·k2 + 2·k3 + k4)
 *
 * Fourth-order accurate (global error O(dt^4)) on smooth ODEs — about three
 * orders of magnitude better than Euler at the same dt. Cost: four derivative
 * evaluations per step.
 *
 * Allocation-free: uses the four `k` slots in `scratch` plus `tmp` for the
 * intermediate states. Caller pre-sizes them once.
 */

import type { Solver, StepContext } from '../solver.js';

export const RK4Solver: Solver = {
  name: 'rk4',
  step(ctx: StepContext): void {
    const { t, dt, state, derivs, scratch } = ctx;
    const { k1, k2, k3, k4, tmp } = scratch;
    const n = state.length;
    const halfDt = dt * 0.5;

    derivs(t, state, k1);

    for (let i = 0; i < n; i++) tmp[i] = state[i]! + k1[i]! * halfDt;
    derivs(t + halfDt, tmp, k2);

    for (let i = 0; i < n; i++) tmp[i] = state[i]! + k2[i]! * halfDt;
    derivs(t + halfDt, tmp, k3);

    for (let i = 0; i < n; i++) tmp[i] = state[i]! + k3[i]! * dt;
    derivs(t + dt, tmp, k4);

    const dt6 = dt / 6;
    for (let i = 0; i < n; i++) {
      state[i] = state[i]! + dt6 * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
    }
  },
};
