import { useMemo } from 'react';

import { runChecks, type CheckResult, type CompiledProgram } from '@sysdyn/core';

interface ChecksProps {
  readonly program: CompiledProgram | null;
}

function formatNum(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? '+∞' : '−∞';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000 || abs < 0.01) return v.toPrecision(3);
  return v.toFixed(Math.max(0, 3 - Math.floor(Math.log10(abs))));
}

export function Checks({ program }: ChecksProps) {
  const results = useMemo<readonly CheckResult[]>(() => {
    if (!program || program.checks.length === 0) return [];
    try {
      return runChecks(program);
    } catch {
      return [];
    }
  }, [program]);

  if (!program) {
    return <div className="placeholder">— compile a model to run checks —</div>;
  }
  if (program.checks.length === 0) {
    return (
      <div className="checks-empty">
        <p>
          No <code>check</code> assertions in this model.
        </p>
        <p className="checks-empty__hint">
          Add a check to assert behaviour over the simulation:
        </p>
        <pre className="checks-empty__example">{`check Population_nonneg:
    when DeathRate = 1.0
    then Population >= 0 always`}</pre>
      </div>
    );
  }

  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const err = results.filter((r) => r.status === 'error').length;

  return (
    <div className="checks">
      <header className="checks__head">
        <h4 className="checks__title">Reality Checks</h4>
        <span className="checks__summary">
          <span className="checks__count checks__count--pass">{pass} pass</span>
          {fail > 0 && (
            <span className="checks__count checks__count--fail">· {fail} fail</span>
          )}
          {err > 0 && (
            <span className="checks__count checks__count--err">· {err} error</span>
          )}
        </span>
      </header>
      <ul className="checks__list">
        {results.map((r) => (
          <li
            key={r.name}
            className={`check check--${r.status}`}
          >
            <div className="check__head">
              <span className={`check__badge check__badge--${r.status}`}>
                {r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '!'}
              </span>
              <code className="check__name">{r.name}</code>
            </div>
            {r.status === 'pass' && (
              <div className="check__detail">
                final: <code>{formatNum(r.lastValue.lhs)}</code> vs{' '}
                <code>{formatNum(r.lastValue.rhs)}</code> at t = {formatNum(r.lastValue.t)}
              </div>
            )}
            {r.status === 'fail' && (
              <div className="check__detail">
                failed at t = {formatNum(r.failedAt.t)}: <code>{formatNum(r.failedAt.lhs)}</code>{' '}
                ↛ <code>{formatNum(r.failedAt.rhs)}</code>
              </div>
            )}
            {r.status === 'error' && <div className="check__detail">{r.message}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
