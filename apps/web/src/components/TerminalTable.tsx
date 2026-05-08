import type { SimulationResult } from '@sysdyn/core';

interface TerminalTableProps {
  readonly result: SimulationResult;
  readonly stockFqns: readonly string[];
}

export function TerminalTable({ result, stockFqns }: TerminalTableProps) {
  return (
    <table className="tt">
      <thead>
        <tr>
          <th>Stock</th>
          <th className="num" style={{ textAlign: 'right' }}>t = start</th>
          <th className="num" style={{ textAlign: 'right' }}>t = end</th>
          <th className="num" style={{ textAlign: 'right' }}>Δ</th>
        </tr>
      </thead>
      <tbody>
        {stockFqns.map((fqn) => {
          const series = result.stocks[fqn];
          if (!series || series.length === 0) return null;
          const init = series[0]!;
          const final = series[series.length - 1]!;
          const delta = final - init;
          const deltaClass =
            !Number.isFinite(delta) || Math.abs(delta) < 1e-9
              ? ''
              : delta > 0
                ? ' num--delta-pos'
                : ' num--delta-neg';
          return (
            <tr key={fqn}>
              <td>{fqn}</td>
              <td className="num">{fmt(init)}</td>
              <td className="num">{fmt(final)}</td>
              <td className={'num' + deltaClass}>{fmtDelta(delta)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 100_000) return v.toExponential(2);
  if (abs >= 1) return v.toFixed(2);
  if (abs >= 0.001) return v.toFixed(4);
  return v.toExponential(2);
}

function fmtDelta(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) < 1e-9) return '±0';
  const sign = v > 0 ? '+' : '−';
  return sign + fmt(Math.abs(v));
}
