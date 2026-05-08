import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

import {
  simulateAll,
  type CompiledProgram,
  type Diagnostic,
  type SimulationResult,
  type VariationResult,
} from '@sysdyn/core';

import { Chart, type ChartSeries } from './Chart.tsx';
import { PrintDiagram } from './PrintDiagram.tsx';
import { buildShareUrl, encodeShare } from '../lib/share.ts';

const SERIES_COLORS = [
  '#0F4C5C',
  '#B23A2C',
  '#A0742E',
  '#5C2B5B',
  '#2E7D5C',
  '#2A6B89',
  '#6F503D',
  '#1F1F1F',
];

const COMPARE_STOCK_LIMIT = 4;
const COMPARE_VARIATION_TABLE_LIMIT = 24;

interface PrintReportProps {
  readonly modelId: string;
  readonly modelTitle: string;
  readonly source: string;
  readonly program: CompiledProgram | null;
  readonly result: SimulationResult | null;
  readonly stockFqns: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  readonly elapsedMs: number;
  readonly onReady: () => void;
}

export function PrintReport({
  modelId,
  modelTitle,
  source,
  program,
  result,
  stockFqns,
  diagnostics,
  elapsedMs,
  onReady,
}: PrintReportProps) {
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [diagramReady, setDiagramReady] = useState(false);
  const [qrReady, setQrReady] = useState(false);

  const handleDiagramReady = useCallback(() => setDiagramReady(true), []);
  // If there's no program at all, mark the diagram ready immediately so the
  // print pipeline doesn't stall.
  useEffect(() => {
    if (!program) setDiagramReady(true);
  }, [program]);

  // ── Async render: QR code with share JWT ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const jwt = await encodeShare({ source, modelId });
        const url = buildShareUrl(jwt);
        const svg = await QRCode.toString(url, {
          type: 'svg',
          margin: 1,
          width: 120,
          errorCorrectionLevel: 'M',
          color: { dark: '#0F4C5C', light: '#FFFFFF' },
        });
        if (cancelled) return;
        setQrSvg(svg);
      } catch {
        // QR failed (e.g. URL too long): omit the QR but don't block the print.
      } finally {
        if (!cancelled) setQrReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, modelId]);

  // Signal readiness only when both async tasks finished (or failed gracefully).
  useEffect(() => {
    if (diagramReady && qrReady) onReady();
  }, [diagramReady, qrReady, onReady]);

  // Single-run series for the Simulation chart.
  const simulationSeries: ChartSeries[] = useMemo(() => {
    if (!result) return [];
    return stockFqns.map((fqn, i) => ({
      fqn,
      label: shortName(fqn),
      values: result.stocks[fqn] ?? new Float64Array(),
      color: SERIES_COLORS[i % SERIES_COLORS.length]!,
      visible: true,
    }));
  }, [result, stockFqns]);

  const variations: readonly VariationResult[] = useMemo(() => {
    if (!program) return [];
    const all = simulateAll(program);
    return all.length > 1 ? all : [];
  }, [program]);

  const compareTimeRef = useMemo(() => {
    if (variations.length === 0) return new Float64Array();
    let t = variations[0]!.result.time;
    for (const v of variations) {
      if (v.result.time.length > t.length) t = v.result.time;
    }
    return t;
  }, [variations]);

  const stepCount = result?.time.length ?? 0;
  const now = new Date();
  const dateStr = now.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;

  return (
    <div className="print-view">
      <header className="print-header">
        <div className="print-brand">
          <span className="print-brand__mark">S</span>
          <span>SYSDYN</span>
          <span className="print-brand__sub">System Dynamics Workbench</span>
        </div>
        <div className="print-meta">
          <span>{dateStr}</span>
        </div>
      </header>

      <div className="print-title-row">
        <div>
          <h1 className="print-title">{modelTitle}</h1>
          <section className="print-meta-grid">
            <div>
              <span className="print-meta-grid__label">Solver</span>
              <span className="print-meta-grid__value">RK4 · 4-stage</span>
            </div>
            <div>
              <span className="print-meta-grid__label">Steps recorded</span>
              <span className="print-meta-grid__value">{stepCount}</span>
            </div>
            <div>
              <span className="print-meta-grid__label">Compile + simulate</span>
              <span className="print-meta-grid__value">{elapsedMs.toFixed(1)} ms</span>
            </div>
            <div>
              <span className="print-meta-grid__label">Stocks</span>
              <span className="print-meta-grid__value">{stockFqns.length}</span>
            </div>
            {program && (
              <>
                <div>
                  <span className="print-meta-grid__label">Scenarios</span>
                  <span className="print-meta-grid__value">{program.scenarios.length}</span>
                </div>
                <div>
                  <span className="print-meta-grid__label">Sweeps</span>
                  <span className="print-meta-grid__value">{program.sweeps.length}</span>
                </div>
              </>
            )}
            {errorCount > 0 && (
              <div className="print-meta-grid__error">
                <span className="print-meta-grid__label">Diagnostics</span>
                <span className="print-meta-grid__value">{errorCount} error(s)</span>
              </div>
            )}
          </section>
        </div>

        {qrSvg && (
          <div className="print-qr">
            <div className="print-qr__svg" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <div className="print-qr__caption">
              Scan to open this<br />simulation live
            </div>
          </div>
        )}
      </div>

      {/* ── 1. Diagram ─────────────────────────────────────────────────────── */}
      {program && (
        <section className="print-section">
          <h2 className="print-h2">Stock-and-flow diagram</h2>
          <PrintDiagram
            program={program}
            result={result}
            onReady={handleDiagramReady}
            width={760}
            height={460}
          />
        </section>
      )}

      {/* ── 2. Simulation (single Base run) ────────────────────────────────── */}
      {result && result.time.length > 0 && (
        <section className="print-section print-section--break">
          <h2 className="print-h2">Simulation — base run</h2>
          <div className="print-chart">
            <Chart time={result.time} series={simulationSeries} />
          </div>
          <PrintLegend series={simulationSeries} />
          <h3 className="print-h3">Terminal stock values</h3>
          <table className="print-table">
            <thead>
              <tr>
                <th>Stock</th>
                <th className="num">t = start</th>
                <th className="num">t = end</th>
                <th className="num">Δ</th>
              </tr>
            </thead>
            <tbody>
              {stockFqns.map((fqn) => {
                const series = result.stocks[fqn];
                if (!series || series.length === 0) return null;
                const init = series[0]!;
                const final = series[series.length - 1]!;
                const delta = final - init;
                return (
                  <tr key={fqn}>
                    <td>{fqn}</td>
                    <td className="num">{fmt(init)}</td>
                    <td className="num">{fmt(final)}</td>
                    <td className="num">{fmtDelta(delta)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* ── 3. Compare — one chart per stock × all variations ──────────────── */}
      {variations.length > 0 && stockFqns.length > 0 && (
        <section className="print-section print-section--break">
          <h2 className="print-h2">
            Compare — {variations.length} variations
          </h2>
          <p className="print-lede">
            Cartesian product of (Base + scenarios) × sweeps. Each chart below
            shows one stock across every variation.
          </p>
          {stockFqns.slice(0, COMPARE_STOCK_LIMIT).map((fqn, idx) => {
            const series: ChartSeries[] = variations.map((v, i) => ({
              fqn: `var_${i}`,
              label: compactLabel(v),
              values: v.result.stocks[fqn] ?? new Float64Array(),
              color: SERIES_COLORS[i % SERIES_COLORS.length]!,
              visible: true,
            }));
            return (
              <div
                key={fqn}
                className={
                  'print-compare-chart' +
                  (idx > 0 ? ' print-compare-chart--break' : '')
                }
              >
                <h3 className="print-h3">{fqn}</h3>
                <Chart time={compareTimeRef} series={series} />
                <PrintLegend series={series} />
              </div>
            );
          })}
          {stockFqns.length > COMPARE_STOCK_LIMIT && (
            <p className="print-note">
              Showing first {COMPARE_STOCK_LIMIT} of {stockFqns.length} stocks.
              Remaining stocks are available in the source code.
            </p>
          )}

          <h3 className="print-h3 print-h3--spaced">Variation summary</h3>
          <table className="print-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Scenario</th>
                <th>Sweep values</th>
                {stockFqns.slice(0, 3).map((fqn) => (
                  <th key={fqn} className="num">
                    {shortName(fqn)} · t=end
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {variations.slice(0, COMPARE_VARIATION_TABLE_LIMIT).map((v, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{v.scenarioName ?? 'Base'}</td>
                  <td>{formatSweep(v.sweepValues)}</td>
                  {stockFqns.slice(0, 3).map((fqn) => {
                    const arr = v.result.stocks[fqn];
                    const final = arr && arr.length > 0 ? arr[arr.length - 1]! : NaN;
                    return (
                      <td key={fqn} className="num">
                        {fmt(final)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {variations.length > COMPARE_VARIATION_TABLE_LIMIT && (
            <p className="print-note">
              Showing first {COMPARE_VARIATION_TABLE_LIMIT} of {variations.length}{' '}
              variations.
            </p>
          )}
        </section>
      )}

      {/* ── 4. Diagnostics (if any) ────────────────────────────────────────── */}
      {diagnostics.length > 0 && (
        <section className="print-section print-section--break">
          <h2 className="print-h2">Diagnostics</h2>
          <ul className="print-diag">
            {diagnostics.map((d, i) => (
              <li key={i} className={`print-diag__item print-diag__item--${d.severity}`}>
                <span className="print-diag__sev">{d.severity.toUpperCase()}</span>
                <span className="print-diag__loc">
                  L{d.range.start.line + 1}:{d.range.start.column + 1}
                </span>
                <span className="print-diag__code">{d.code}</span>
                <span className="print-diag__msg">{d.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 5. Annex — Source code ─────────────────────────────────────────── */}
      <section className="print-section print-section--break">
        <div className="print-annex-mark">Annex A</div>
        <h2 className="print-h2">Source code</h2>
        <pre className="print-source">{source}</pre>
      </section>

      <footer className="print-footer">
        Generated by @sysdyn/web · github.com/Banbinal/systemdynamicsdiagram
      </footer>
    </div>
  );
}

/** Color-swatch legend rendered below each print chart. */
function PrintLegend({ series }: { series: readonly ChartSeries[] }) {
  if (series.length === 0) return null;
  return (
    <div className="print-legend" aria-label="Series legend">
      {series.map((s) => (
        <div key={s.fqn} className="print-legend__item">
          <span
            className="print-legend__swatch"
            style={{ background: s.color }}
            aria-hidden="true"
          />
          <span className="print-legend__label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function shortName(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i < 0 ? fqn : fqn.slice(i + 1);
}

function compactLabel(v: VariationResult): string {
  const sweepEntries = Object.entries(v.sweepValues);
  const sweepStr = sweepEntries
    .map(([k, val]) => `${shortName(k)}=${fmtNumberShort(val)}`)
    .join(', ');
  const scn = v.scenarioName ?? 'Base';
  return sweepStr ? `${scn} · ${sweepStr}` : scn;
}

function formatSweep(values: Readonly<Record<string, number>>): string {
  const entries = Object.entries(values);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${shortName(k)}=${fmtNumberShort(v)}`).join(', ');
}

function fmtNumberShort(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 1) return v.toFixed(2);
  if (abs >= 0.001) return v.toFixed(4);
  return v.toExponential(1);
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
