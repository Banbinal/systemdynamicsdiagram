/**
 * Solver interface and step context.
 *
 * Solvers consume a `derivs` function that fills `out` with d(state)/dt for the
 * current `state` at time `t`. RK4 and Euler implementations land in PR 7.
 *
 * The interface is intentionally minimal so future adaptive solvers (RK45, BDF)
 * can substep internally without breaking the API.
 */

export type DerivativeFn = (
  t: number,
  state: Float64Array,
  out: Float64Array,
) => void;

export interface StepScratch {
  readonly k1: Float64Array;
  readonly k2: Float64Array;
  readonly k3: Float64Array;
  readonly k4: Float64Array;
  readonly tmp: Float64Array;
}

export interface StepContext {
  /** Current simulation time. Solvers may consult but do not mutate. */
  readonly t: number;
  /** Time step. */
  readonly dt: number;
  /** State vector — mutated in place by the solver. */
  readonly state: Float64Array;
  /** Closure that fills `out` with derivatives at (`t`, `state`). */
  readonly derivs: DerivativeFn;
  /** Pre-allocated buffers (sized = state.length) so solvers don't allocate per step. */
  readonly scratch: StepScratch;
}

export interface Solver {
  readonly name: string;
  /** Advance `state` by one timestep in place. */
  step(ctx: StepContext): void;
}
