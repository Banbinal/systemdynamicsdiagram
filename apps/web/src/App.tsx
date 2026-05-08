import { useCallback, useEffect, useMemo, useState } from 'react';

import { simulate, type SimulationResult } from '@sysdyn/core';

import { EXAMPLES, DEFAULT_EXAMPLE, type Example } from './examples.ts';
import { useSimulation } from './hooks/useSimulation.ts';
import {
  buildShareUrl,
  consumeShareTokenFromHash,
  decodeShare,
  encodeShare,
} from './lib/share.ts';

import { Editor } from './components/Editor.tsx';
import { Chart, type ChartSeries, type ReferenceOverlay } from './components/Chart.tsx';
import { ChartLegend } from './components/ChartLegend.tsx';
import { Diagnostics } from './components/Diagnostics.tsx';
import { TerminalTable } from './components/TerminalTable.tsx';
import { Header } from './components/Header.tsx';
import { Diagram } from './components/Diagram.tsx';
import { Loops } from './components/Loops.tsx';
import { Tweak } from './components/Tweak.tsx';
import { Checks } from './components/Checks.tsx';
import { PhasePlot } from './components/PhasePlot.tsx';
import { Tornado } from './components/Tornado.tsx';
import { importXmile } from './lib/xmileImport.ts';
import { exportXmile } from './lib/xmileExport.ts';
import { Compare } from './components/Compare.tsx';
import { PrintReport } from './components/PrintReport.tsx';
import { Toast, type ToastKind } from './components/Toast.tsx';
import { Docs } from './components/Docs.tsx';
import { AiAssistModal } from './components/AiAssistModal.tsx';

const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
];

type Tab = 'model' | 'simulation' | 'compare' | 'data' | 'checks' | 'sensitivity';
type View = 'workbench' | 'docs';

const SKILL_ZIP_HREF = `${import.meta.env.BASE_URL}system-dynamics-diagram.zip`;

function shortName(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i < 0 ? fqn : fqn.slice(i + 1);
}

/** Strip the `embed=1` (and `tab=…`) params so the breakout link opens the
 *  full editor. Preserves the share-link hash if present. */
function removeEmbedFromHref(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('embed');
  url.searchParams.delete('tab');
  return url.toString();
}

interface ToastMsg {
  readonly id: number;
  readonly text: string;
  readonly kind: ToastKind;
}

type PrintingState = 'off' | 'mounting' | 'ready';

const TAB_NAMES: Tab[] = ['model', 'simulation', 'compare', 'data', 'checks', 'sensitivity'];

/** Read embed mode + initial tab from `?embed=1[&tab=simulation]` once at boot. */
function readEmbedConfig(): { embed: boolean; initialTab: Tab | null } {
  if (typeof window === 'undefined') return { embed: false, initialTab: null };
  const params = new URLSearchParams(window.location.search);
  const embed = params.get('embed') === '1';
  const tabParam = params.get('tab');
  const initialTab: Tab | null =
    tabParam && (TAB_NAMES as string[]).includes(tabParam) ? (tabParam as Tab) : null;
  return { embed, initialTab };
}

export function App() {
  const embedConfig = useMemo(() => readEmbedConfig(), []);
  const embedMode = embedConfig.embed;
  const [activeId, setActiveId] = useState<string>(DEFAULT_EXAMPLE.id);
  const [sources, setSources] = useState<Record<string, string>>(() =>
    Object.fromEntries(EXAMPLES.map((ex) => [ex.id, ex.source])),
  );
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  // SyntheSim-style live overrides: keyed by constant FQN. Reset on model change.
  const [tweakOverrides, setTweakOverrides] = useState<Readonly<Record<string, number>>>({});
  const [tab, setTab] = useState<Tab>(embedConfig.initialTab ?? 'model');
  // Phase-plot mode: time series (default) vs (X(t), Y(t)) trajectory.
  const [plotMode, setPlotMode] = useState<'time' | 'phase'>('time');
  const [phaseX, setPhaseX] = useState<string>('');
  const [phaseY, setPhaseY] = useState<string>('');
  const [view, setView] = useState<View>('workbench');
  const [toasts, setToasts] = useState<readonly ToastMsg[]>([]);
  const [printing, setPrinting] = useState<PrintingState>('off');
  const [aiOpen, setAiOpen] = useState(false);

  const pushToast = useCallback((text: string, kind: ToastKind = 'ok') => {
    setToasts((prev) => [...prev, { id: Date.now() + Math.random(), text, kind }]);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Decode shared token from URL hash ────────────────────────────────────
  // Strategy: the model picker is examples-only. A share link drops its source
  // into the slot hinted by `payload.modelId` (or the first example as
  // fallback) and switches to that slot — overwriting whatever the user had
  // there.
  //
  // We run on first mount AND on `hashchange`. The second case matters because
  // pasting a `…/#t=…` URL into the address bar of an already-loaded tab does
  // not trigger a navigation — only a `hashchange` event — so without the
  // listener the share would silently no-op.
  //
  // Note: this effect intentionally has *no* cancellation. In React 18 dev
  // strict mode the effect runs setup → teardown → setup. With a `cancelled`
  // flag, the first async decode would bail just before applying state, and
  // the second invocation would see a cleared hash and skip → the share never
  // loads. Without cancellation the first decode applies state cleanly and
  // the second invocation early-returns at `if (!token)`. Idempotent.
  useEffect(() => {
    const consumeAndApply = () => {
      const token = consumeShareTokenFromHash();
      if (!token) return;
      decodeShare(token).then((payload) => {
        if (!payload) {
          pushToast('Could not decode shared link — token invalid or tampered.', 'error');
          return;
        }
        const target =
          EXAMPLES.find((e) => e.id === payload.modelId) ?? DEFAULT_EXAMPLE;
        setSources((prev) => ({ ...prev, [target.id]: payload.source }));
        setActiveId(target.id);
        pushToast(`Shared model loaded into ${target.title}.`, 'ok');
      });
    };
    consumeAndApply();
    window.addEventListener('hashchange', consumeAndApply);
    return () => window.removeEventListener('hashchange', consumeAndApply);
  }, [pushToast]);

  const active: Example =
    EXAMPLES.find((e) => e.id === activeId) ?? DEFAULT_EXAMPLE;
  const source = sources[active.id] ?? active.source;

  const sim = useSimulation(source);

  const handleSelect = (id: string) => {
    setActiveId(id);
    setHidden(new Set());
    setTweakOverrides({});
  };
  const handleEdit = (next: string) => {
    setSources((prev) => ({ ...prev, [active.id]: next }));
  };

  // Reset overrides when the underlying program changes (recompile from edit
  // or model swap). The compiled program identity changes per recompile so a
  // referential check is enough; this keeps tweaks across pure UI changes.
  useEffect(() => {
    setTweakOverrides({});
  }, [sim.program]);

  // Default phase-plot axes: first two stocks (in declaration order). Reset
  // when the model changes so we don't carry stale FQNs into a different
  // model that happens to be open.
  useEffect(() => {
    if (sim.stockFqns.length >= 2) {
      setPhaseX(sim.stockFqns[0]!);
      setPhaseY(sim.stockFqns[1]!);
    } else if (sim.stockFqns.length === 1) {
      setPhaseX(sim.stockFqns[0]!);
      setPhaseY(sim.stockFqns[0]!);
    } else {
      setPhaseX('');
      setPhaseY('');
    }
  }, [sim.stockFqns]);

  // Default values per constant — what `simulate` would pick if no override
  // were applied. We need these for the slider range and "modified" indicator.
  // Approximated by reading the *initial* values from the canonical sim result;
  // fallback: 0. (Constants don't appear in `result.calcs`, but they're the
  // result of evaluating CompiledExpr against literals/other constants — a
  // proper read-out would require exposing the runtime's constants buffer.
  // For v1, we re-run a no-override simulate just to get them; cheap enough.)
  const tweakDefaults = useMemo<Readonly<Record<string, number>>>(() => {
    if (!sim.program) return {};
    // Extract constant defaults by re-using the runtime's evaluator via a
    // throwaway simulate; the values land in `result.calcs` only for `calc`s,
    // so for now we read them off the IR by best-effort. The simplest correct
    // path is to expose them on the program API — until then, a no-override
    // simulate followed by a peek wouldn't give us constants either.
    // Pragmatic compromise: rely on each constant having a NumberLit or const-
    // foldable expr; otherwise a slider centred on 0 still works.
    const out: Record<string, number> = {};
    for (const c of sim.program.constants) {
      // Const fold: walk the CompiledExpr ops looking for a single PushNum.
      const ops = c.expr.ops;
      const op0 = ops[0];
      if (ops.length === 1 && op0 && op0.kind === 'PushNum') {
        out[c.fqn] = op0.value;
      } else {
        // Mixed expression — leave it to the slider's effective bound logic
        // (which uses 0 as a sane fallback). The user can still drag from 0.
        out[c.fqn] = 0;
      }
    }
    return out;
  }, [sim.program]);

  // Tweaked simulation: re-run only when overrides or program change. Falls
  // back to the canonical run when there are no overrides, to avoid the cost.
  const tweakedResult = useMemo<SimulationResult | null>(() => {
    if (!sim.program || !sim.result) return sim.result;
    if (Object.keys(tweakOverrides).length === 0) return sim.result;
    try {
      return simulate(sim.program, { overrides: tweakOverrides });
    } catch {
      return sim.result;
    }
  }, [sim.program, sim.result, tweakOverrides]);

  const errorCount = useMemo(
    () => sim.diagnostics.filter((d) => d.severity === 'error').length,
    [sim.diagnostics],
  );
  const warnCount = useMemo(
    () => sim.diagnostics.filter((d) => d.severity === 'warning').length,
    [sim.diagnostics],
  );

  // The chart uses the tweaked result whenever overrides are non-empty so
  // SyntheSim sliders feel live.
  const chartResult = tweakedResult ?? sim.result;

  // Reference modes — pulled off the compiled program. Each one is matched
  // to its target stock's chart-series colour so the dashed overlay sits
  // visually next to the simulated line it targets.
  const referenceOverlays: ReferenceOverlay[] = useMemo(() => {
    if (!sim.program) return [];
    return sim.program.references.map((r) => {
      const idx = sim.stockFqns.indexOf(r.fqn);
      const color = idx >= 0
        ? SERIES_COLORS[idx % SERIES_COLORS.length]!
        : 'var(--ink-3)';
      return { fqn: r.fqn, points: r.points, color };
    });
  }, [sim.program, sim.stockFqns]);
  const series: ChartSeries[] = useMemo(() => {
    if (!chartResult) return [];
    return sim.stockFqns.map((fqn, i) => ({
      fqn,
      label: shortName(fqn),
      values: chartResult.stocks[fqn] ?? new Float64Array(),
      color: SERIES_COLORS[i % SERIES_COLORS.length]!,
      visible: !hidden.has(fqn),
    }));
  }, [chartResult, sim.stockFqns, hidden]);

  const toggleSeries = (fqn: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(fqn)) next.delete(fqn);
      else next.add(fqn);
      return next;
    });
  };

  const stepCount = sim.result?.time.length ?? 0;

  // ── Share handler ─────────────────────────────────────────────────────────
  // Two visible signals are produced on click so the user knows it worked:
  //   1. the address bar is rewritten to include `#t=<JWT>`
  //   2. the URL is copied to the clipboard (with a `prompt()` fallback)
  // plus a toast confirms.
  const handleShare = useCallback(async () => {
    try {
      if (!source.trim()) {
        pushToast('Nothing to share — source is empty.', 'error');
        return;
      }
      const jwt = await encodeShare({ source, modelId: active.id });
      const url = buildShareUrl(jwt);
      // Visible signal #1: rewrite the URL hash so the address bar shows the JWT.
      // We don't push history — replaceState keeps the back button clean.
      history.replaceState(null, '', `#t=${jwt}`);
      // Visible signal #2: clipboard.
      try {
        await navigator.clipboard.writeText(url);
        pushToast('Share link copied — and visible in the address bar.', 'ok');
      } catch {
        window.prompt('Copy this share link:', url);
        pushToast('Share link in URL bar — copy manually if needed.', 'info');
      }
    } catch (err) {
      pushToast(
        'Failed to build share link: ' + (err instanceof Error ? err.message : String(err)),
        'error',
      );
    }
  }, [source, active.id, pushToast]);

  // ── Skill download ───────────────────────────────────────────────────────
  // The zip is generated at build time by scripts/build-skill-zip.mjs and
  // served as a static asset. We trigger the download via a transient anchor
  // rather than navigating away from the SPA.
  const handleDownloadSkill = useCallback(() => {
    const a = document.createElement('a');
    a.href = SKILL_ZIP_HREF;
    a.download = 'system-dynamics-diagram.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    pushToast('Downloading skill bundle…', 'ok');
  }, [pushToast]);

  // ── XMILE import / export ────────────────────────────────────────────────
  // Imported XMILE replaces the current model's source. The user keeps the
  // ability to flip back to the canned examples via the picker.
  const handleImportXmile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const xml = String(reader.result ?? '');
        const { dsl, warnings } = importXmile(xml);
        if (!dsl) {
          pushToast(
            'Could not import XMILE: ' + (warnings[0] ?? 'unknown error'),
            'error',
          );
          return;
        }
        setSources((prev) => ({ ...prev, [active.id]: dsl }));
        const warnMsg = warnings.length > 0
          ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'} — see editor comments).`
          : '.';
        pushToast(`Imported XMILE into ${active.title}${warnMsg}`, warnings.length > 0 ? 'info' : 'ok');
        if (warnings.length > 0) {
          // eslint-disable-next-line no-console
          console.warn('[XMILE import]', warnings);
        }
      };
      reader.onerror = () => {
        pushToast('Failed to read the file.', 'error');
      };
      reader.readAsText(file);
    },
    [active.id, active.title, pushToast],
  );

  const handleExportXmile = useCallback(() => {
    if (!source.trim()) {
      pushToast('Nothing to export — source is empty.', 'error');
      return;
    }
    const { xml, warnings } = exportXmile(source, active.title);
    if (!xml) {
      pushToast(
        'Could not export XMILE: ' + (warnings[0] ?? 'parse error'),
        'error',
      );
      return;
    }
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active.id}.xmile`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    const warnMsg = warnings.length > 0
      ? ` (${warnings.length} feature${warnings.length === 1 ? '' : 's'} not representable in XMILE — see console).`
      : '.';
    pushToast(`Exported as ${active.id}.xmile${warnMsg}`, warnings.length > 0 ? 'info' : 'ok');
    if (warnings.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[XMILE export]', warnings);
    }
  }, [source, active.id, active.title, pushToast]);

  // ── PDF export ───────────────────────────────────────────────────────────
  const handleExportPdf = useCallback(() => {
    if (sim.status === 'error') {
      pushToast('Resolve diagnostics before exporting.', 'error');
      return;
    }
    setPrinting('mounting');
  }, [sim.status, pushToast]);

  const handlePrintReady = useCallback(() => {
    setPrinting('ready');
  }, []);

  // Once the print view is ready (Mermaid has rendered), trigger the print
  // dialog. Wait for the `afterprint` event to unmount PrintReport so the
  // browser doesn't capture a half-disposed DOM if the user lingers in the
  // print dialog.
  useEffect(() => {
    if (printing !== 'ready') return;
    const reset = () => setPrinting('off');
    window.addEventListener('afterprint', reset, { once: true });
    const t = setTimeout(() => {
      window.print();
    }, 80);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', reset);
    };
  }, [printing]);

  const variationCount = useMemo(() => {
    if (!sim.program) return 0;
    const scenarioCount = sim.program.scenarios.length + 1; // +1 for Base
    let sweepCombos = 1;
    for (const sw of sim.program.sweeps) sweepCombos *= sw.values.length;
    return scenarioCount * sweepCombos;
  }, [sim.program]);
  const canCompare = variationCount > 1 && sim.program !== null;

  if (view === 'docs') {
    return (
      <Docs
        onClose={() => setView('workbench')}
        onDownload={handleDownloadSkill}
      />
    );
  }

  return (
    <>
    <div className={'app' + (embedMode ? ' app--embed' : '')}>
      {!embedMode && (
        <Header
          examples={EXAMPLES}
          activeId={active.id}
          onSelect={handleSelect}
          status={sim.status}
          elapsedMs={sim.elapsedMs}
          stepCount={stepCount}
          onShare={handleShare}
          onExportPdf={handleExportPdf}
          isExporting={printing !== 'off'}
          onOpenDocs={() => setView('docs')}
          onDownloadSkill={handleDownloadSkill}
          onImportXmile={handleImportXmile}
          onExportXmile={handleExportXmile}
        />
      )}

      {embedMode && (
        <a
          className="embed-breakout"
          href={removeEmbedFromHref(window.location.href)}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in the full editor"
        >
          ↗ Open in editor
        </a>
      )}

      <div className="main">
        {!embedMode && (
        <section className="pane pane--left">
          <div className="pane__header">Source · {active.title}.sd</div>

          {sim.diagnostics.length > 0 ? (
            <div className="diag-strip">
              <div className="diag-strip__head">
                <span
                  className={
                    'diag-strip__count ' +
                    (errorCount > 0 ? 'diag-strip__count--err' : '')
                  }
                >
                  {errorCount} error{errorCount === 1 ? '' : 's'}
                </span>
                {warnCount > 0 && (
                  <span className="diag-strip__count">
                    · {warnCount} warning{warnCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <Diagnostics items={sim.diagnostics} />
            </div>
          ) : sim.result ? (
            <div className="diag-strip--ok">
              No diagnostics — model compiles and simulates cleanly.
            </div>
          ) : null}

          <div className="editor-host">
            <Editor
              value={source}
              onChange={handleEdit}
              onAiAssist={() => setAiOpen(true)}
            />
          </div>
        </section>
        )}

        <section className="pane pane--right">
          <div className="tabs" role="tablist">
            <button
              className="tab"
              role="tab"
              aria-selected={tab === 'model'}
              onClick={() => setTab('model')}
            >
              Model
            </button>
            <button
              className="tab"
              role="tab"
              aria-selected={tab === 'simulation'}
              onClick={() => setTab('simulation')}
              disabled={!sim.result}
            >
              Simulation
              {series.length > 0 && (
                <span className="tab__count">{series.length}</span>
              )}
            </button>
            <button
              className="tab"
              role="tab"
              aria-selected={tab === 'compare'}
              onClick={() => setTab('compare')}
              disabled={!canCompare}
              title={canCompare ? '' : 'Add a scenario or sweep to compare alternatives'}
            >
              Compare
              {variationCount > 1 && (
                <span className="tab__count">{variationCount}</span>
              )}
            </button>
            <button
              className="tab"
              role="tab"
              aria-selected={tab === 'data'}
              onClick={() => setTab('data')}
              disabled={!sim.result}
            >
              Data
              {sim.stockFqns.length > 0 && (
                <span className="tab__count">{sim.stockFqns.length}</span>
              )}
            </button>
            {sim.program && sim.program.checks.length > 0 && (
              <button
                className="tab"
                role="tab"
                aria-selected={tab === 'checks'}
                onClick={() => setTab('checks')}
              >
                Checks
                <span className="tab__count">{sim.program.checks.length}</span>
              </button>
            )}
            {sim.program && sim.program.sweeps.length > 0 && (
              <button
                className="tab"
                role="tab"
                aria-selected={tab === 'sensitivity'}
                onClick={() => setTab('sensitivity')}
              >
                Sensitivity
                <span className="tab__count">{sim.program.sweeps.length}</span>
              </button>
            )}
          </div>

          <div className="tab-content" role="tabpanel">
            {tab === 'model' && (
              <div className="card card--fill">
                <div className="card__title">
                  <h3 className="card__title-text">Stock-and-flow diagram</h3>
                  <span className="card__title-sub">{active.title}</span>
                </div>
                <div className="model-layout">
                  <div className="model-layout__diagram">
                    <Diagram program={sim.program} result={chartResult} />
                  </div>
                  <Loops program={sim.program} />
                </div>
              </div>
            )}

            {tab === 'simulation' && (
              <div className="card card--fill">
                <div className="card__title">
                  <h3 className="card__title-text">Stocks over time</h3>
                  <span className="card__title-sub">
                    solver: rk4 · {stepCount} steps · {sim.elapsedMs.toFixed(1)}ms
                    {Object.keys(tweakOverrides).length > 0 && (
                      <span className="card__title-tag">
                        · live tweak ({Object.keys(tweakOverrides).length})
                      </span>
                    )}
                  </span>
                </div>
                <div className="sim-toolbar" role="group" aria-label="Plot mode">
                  <div className="sim-toolbar__modes">
                    <button
                      type="button"
                      className={'sim-toolbar__mode' + (plotMode === 'time' ? ' sim-toolbar__mode--on' : '')}
                      onClick={() => setPlotMode('time')}
                    >
                      Time series
                    </button>
                    <button
                      type="button"
                      className={'sim-toolbar__mode' + (plotMode === 'phase' ? ' sim-toolbar__mode--on' : '')}
                      onClick={() => setPlotMode('phase')}
                      disabled={sim.stockFqns.length < 2}
                      title={
                        sim.stockFqns.length < 2
                          ? 'Phase plot needs at least two stocks'
                          : 'Plot one stock against another in state space'
                      }
                    >
                      Phase plot
                    </button>
                  </div>
                  {plotMode === 'phase' && sim.stockFqns.length >= 2 && (
                    <div className="sim-toolbar__axes">
                      <label className="sim-toolbar__axis">
                        <span>X</span>
                        <select value={phaseX} onChange={(e) => setPhaseX(e.target.value)}>
                          {sim.stockFqns.map((fqn) => (
                            <option key={fqn} value={fqn}>{shortName(fqn)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="sim-toolbar__axis">
                        <span>Y</span>
                        <select value={phaseY} onChange={(e) => setPhaseY(e.target.value)}>
                          {sim.stockFqns.map((fqn) => (
                            <option key={fqn} value={fqn}>{shortName(fqn)}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </div>
                <div className="sim-layout">
                  <div className="sim-layout__chart">
                    {chartResult && chartResult.time.length > 0 ? (
                      plotMode === 'time' ? (
                        <>
                          <Chart
                            time={chartResult.time}
                            series={series}
                            references={referenceOverlays}
                          />
                          <ChartLegend series={series} onToggle={toggleSeries} />
                        </>
                      ) : (
                        <PhasePlot
                          time={chartResult.time}
                          xValues={chartResult.stocks[phaseX] ?? new Float64Array()}
                          yValues={chartResult.stocks[phaseY] ?? new Float64Array()}
                          xLabel={shortName(phaseX)}
                          yLabel={shortName(phaseY)}
                          color={
                            SERIES_COLORS[
                              sim.stockFqns.indexOf(phaseY) % SERIES_COLORS.length
                            ] ?? SERIES_COLORS[0]!
                          }
                        />
                      )
                    ) : (
                      <div className="placeholder">
                        {sim.status === 'error'
                          ? 'Resolve the diagnostics above to run the simulation.'
                          : 'Compiling…'}
                      </div>
                    )}
                  </div>
                  <Tweak
                    program={sim.program}
                    overrides={tweakOverrides}
                    onChange={setTweakOverrides}
                    defaults={tweakDefaults}
                  />
                </div>
              </div>
            )}

            {tab === 'compare' && (
              <Compare program={sim.program} stockFqns={sim.stockFqns} />
            )}

            {tab === 'data' && (
              <div className="card">
                <div className="card__title">
                  <h3 className="card__title-text">Terminal stock values</h3>
                  <span className="card__title-sub">
                    initial → final, with delta
                  </span>
                </div>
                {sim.result && sim.result.time.length > 0 ? (
                  <TerminalTable result={sim.result} stockFqns={sim.stockFqns} />
                ) : (
                  <div className="placeholder">No simulation data.</div>
                )}
              </div>
            )}

            {tab === 'checks' && (
              <div className="card">
                <div className="card__title">
                  <h3 className="card__title-text">Reality Check assertions</h3>
                  <span className="card__title-sub">
                    each check runs an isolated simulation with its `when` overrides
                  </span>
                </div>
                <Checks program={sim.program} />
              </div>
            )}

            {tab === 'sensitivity' && (
              <div className="card">
                <div className="card__title">
                  <h3 className="card__title-text">Tornado — one-at-a-time sensitivity</h3>
                  <span className="card__title-sub">
                    each sweep low/high vs baseline; sorted by |swing|
                  </span>
                </div>
                <Tornado program={sim.program} stockFqns={sim.stockFqns} />
              </div>
            )}
          </div>
        </section>
      </div>

      {aiOpen && (
        <AiAssistModal
          currentSource={source}
          onClose={() => setAiOpen(false)}
          onApply={(generated) => {
            setSources((prev) => ({ ...prev, [active.id]: generated }));
            pushToast('Model generated and inserted into the editor.', 'ok');
          }}
        />
      )}

      {/* Toast stack — fixed-positioned, hidden in print via @media print */}
      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map((t) => (
            <Toast
              key={t.id}
              message={t.text}
              kind={t.kind}
              onDismiss={() => dismissToast(t.id)}
            />
          ))}
        </div>
      )}
    </div>

    {/*
      PrintReport must be a sibling of .app, NOT a child. In `@media print`
      we set `.app { display: none }` to hide the screen UI; that cascade
      kills any descendant including .print-view, so the print would come
      out empty. Rendering it at the root keeps the print subtree alive.
    */}
    {printing !== 'off' && (
      <PrintReport
        modelId={active.id}
        modelTitle={active.title}
        source={source}
        program={sim.program}
        result={sim.result}
        stockFqns={sim.stockFqns}
        diagnostics={sim.diagnostics}
        elapsedMs={sim.elapsedMs}
        onReady={handlePrintReady}
      />
    )}
    </>
  );
}
