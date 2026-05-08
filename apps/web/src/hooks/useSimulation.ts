import { useEffect, useRef, useState } from 'react';
import {
  build,
  hasErrors,
  simulate,
  type CompiledProgram,
  type Diagnostic,
  type SimulationResult,
} from '@sysdyn/core';

export type SimStatus = 'idle' | 'running' | 'ok' | 'error';

export interface SimState {
  readonly status: SimStatus;
  readonly diagnostics: readonly Diagnostic[];
  readonly program: CompiledProgram | null;
  readonly result: SimulationResult | null;
  readonly stockFqns: readonly string[];   // non-synthetic stocks, in declaration order
  readonly elapsedMs: number;
}

const EMPTY: SimState = {
  status: 'idle',
  diagnostics: [],
  program: null,
  result: null,
  stockFqns: [],
  elapsedMs: 0,
};

/**
 * Debounced parse + compile + simulate pipeline.
 *
 * On every source change we wait `debounceMs` then run the full pipeline.
 * Results — and any diagnostics — flow through a single immutable state.
 *
 * The pipeline is synchronous (no Web Worker yet), so we yield via setTimeout
 * to keep the UI responsive on long simulations.
 */
export function useSimulation(source: string, debounceMs = 220): SimState {
  const [state, setState] = useState<SimState>(EMPTY);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    setState((prev) => ({ ...prev, status: 'running' }));
    const seq = ++seqRef.current;

    timerRef.current = setTimeout(() => {
      const t0 = performance.now();

      // 1. Parse + compile
      const { program, diagnostics } = build(source, { fileName: 'model.sd' });
      if (hasErrors(diagnostics)) {
        if (seq === seqRef.current) {
          setState({
            status: 'error',
            diagnostics,
            program: null,
            result: null,
            stockFqns: [],
            elapsedMs: performance.now() - t0,
          });
        }
        return;
      }

      // 2. Simulate
      let result: SimulationResult;
      try {
        result = simulate(program);
      } catch (err) {
        if (seq === seqRef.current) {
          setState({
            status: 'error',
            diagnostics: [
              {
                severity: 'error',
                code: 'SD9999',
                message: err instanceof Error ? err.message : String(err),
                range: {
                  start: { offset: 0, line: 0, column: 0 },
                  end: { offset: 0, line: 0, column: 0 },
                },
              },
            ],
            program,
            result: null,
            stockFqns: [],
            elapsedMs: performance.now() - t0,
          });
        }
        return;
      }

      // 3. Stash a stable stock list in declaration order, hiding synthetic stocks.
      const stockFqns = program.stocks
        .filter((s) => !s.synthetic)
        .map((s) => s.fqn);

      const allDiag: Diagnostic[] = [...diagnostics, ...result.diagnostics];
      if (seq === seqRef.current) {
        setState({
          status: hasErrors(allDiag) ? 'error' : 'ok',
          diagnostics: allDiag,
          program,
          result,
          stockFqns,
          elapsedMs: performance.now() - t0,
        });
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [source, debounceMs]);

  return state;
}
