import { useState } from 'react';

import {
  runCalibration,
  type CalibrationResult,
  type CompiledProgram,
} from '@sysdyn/core';

interface CalibrateProps {
  readonly program: CompiledProgram | null;
  /**
   * Called with the fitted parameter overrides when the user clicks "Apply
   * to live tweak". Plugged into the SyntheSim slider state so the chart
   * redraws against the calibrated parameters immediately.
   */
  readonly onApplyFit: (overrides: Record<string, number>) => void;
}

function shortName(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i < 0 ? fqn : fqn.slice(i + 1);
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000 || abs < 0.01) return v.toPrecision(4);
  return v.toFixed(4);
}

export function Calibrate({ program, onApplyFit }: CalibrateProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CalibrationResult | null>(null);

  if (!program) {
    return <div className="placeholder">— compile a model to calibrate —</div>;
  }
  if (!program.calibration) {
    return (
      <div className="cal-empty">
        <p>
          No <code>calibrate</code> block declared. Add one to fit constants
          against the model's reference modes:
        </p>
        <pre className="cal-empty__example">{`reference Population:
    (0, 100)
    (10, 220)
    (20, 380)

calibrate:
    bounds BirthRate = [0.01, 0.5]
    bounds CarryingCapacity = [100, 2000]`}</pre>
        <p className="cal-empty__hint">
          Calibration runs Nelder-Mead on the bounded parameters and reports
          the values that minimise RMSE against the reference points.
        </p>
      </div>
    );
  }

  const handleRun = () => {
    setRunning(true);
    // Yield to the browser so the "running…" state actually paints before
    // we start the synchronous simulate-loop.
    setTimeout(() => {
      const r = runCalibration(program);
      setResult(r);
      setRunning(false);
    }, 16);
  };

  const handleApply = () => {
    if (result?.status !== 'ok') return;
    const overrides: Record<string, number> = {};
    for (const p of result.params) overrides[p.fqn] = p.fitted;
    onApplyFit(overrides);
  };

  const params = program.calibration.params;

  return (
    <div className="cal">
      <header className="cal__head">
        <h4 className="cal__title">Calibration</h4>
        <span className="cal__summary">
          Nelder-Mead · {params.length} param{params.length === 1 ? '' : 's'} ·{' '}
          {program.references.length} reference mode{program.references.length === 1 ? '' : 's'}
        </span>
      </header>

      <div className="cal__params">
        {params.map((p) => (
          <div key={p.fqn} className="cal__param">
            <code className="cal__param-name">{shortName(p.fqn)}</code>
            <span className="cal__param-bounds">
              ∈ [{fmt(p.low)}, {fmt(p.high)}]
            </span>
          </div>
        ))}
      </div>

      <div className="cal__run-row">
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleRun}
          disabled={running || program.references.length === 0}
          title={
            program.references.length === 0
              ? 'Declare at least one `reference` mode to calibrate against.'
              : ''
          }
        >
          {running ? 'Calibrating…' : 'Run calibration'}
        </button>
        {result?.status === 'ok' && (
          <button
            type="button"
            className="btn"
            onClick={handleApply}
            title="Apply the fitted values as live tweaks (visible immediately on the chart)"
          >
            Apply to live tweak
          </button>
        )}
      </div>

      {result?.status === 'error' && (
        <div className="cal__error">
          <strong>Error:</strong> {result.message}
        </div>
      )}

      {result?.status === 'ok' && (
        <>
          <div className="cal__cost">
            <div className="cal__cost-row">
              <span>RMSE before</span>
              <code>{fmt(result.initialCost)}</code>
            </div>
            <div className="cal__cost-row cal__cost-row--final">
              <span>RMSE after</span>
              <code>{fmt(result.finalCost)}</code>
            </div>
            <div className="cal__cost-row cal__cost-row--meta">
              <span>iterations</span>
              <code>{result.iterations}</code>
            </div>
          </div>
          <table className="cal__table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th className="num">Initial</th>
                <th className="num">Fitted</th>
                <th>Range</th>
              </tr>
            </thead>
            <tbody>
              {result.params.map((p) => {
                const range = p.high - p.low;
                const initialPos = range > 0 ? ((p.initial - p.low) / range) * 100 : 50;
                const fittedPos = range > 0 ? ((p.fitted - p.low) / range) * 100 : 50;
                return (
                  <tr key={p.fqn}>
                    <td>
                      <code>{shortName(p.fqn)}</code>
                    </td>
                    <td className="num">{fmt(p.initial)}</td>
                    <td className="num cal__table-fitted">{fmt(p.fitted)}</td>
                    <td>
                      <div className="cal__range">
                        <span className="cal__range-low">{fmt(p.low)}</span>
                        <div className="cal__range-bar">
                          <span
                            className="cal__range-marker cal__range-marker--initial"
                            style={{ left: `${initialPos}%` }}
                            title={`initial: ${fmt(p.initial)}`}
                          />
                          <span
                            className="cal__range-marker cal__range-marker--fitted"
                            style={{ left: `${fittedPos}%` }}
                            title={`fitted: ${fmt(p.fitted)}`}
                          />
                        </div>
                        <span className="cal__range-high">{fmt(p.high)}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
