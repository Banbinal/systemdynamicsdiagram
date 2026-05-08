import { useMemo } from 'react';

import type { CompiledProgram, SimulationResult, Symbol } from '@sysdyn/core';

interface CausalLensProps {
  readonly fqn: string;
  readonly program: CompiledProgram;
  readonly result: SimulationResult | null;
  readonly onSelect: (fqn: string) => void;
  readonly onClose: () => void;
}

function shortName(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i < 0 ? fqn : fqn.slice(i + 1);
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000 || abs < 0.01) return v.toPrecision(3);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function polClass(p: '+' | '-' | '?'): string {
  return p === '+' ? 'pos' : p === '-' ? 'neg' : 'unk';
}

function polGlyph(p: '+' | '-' | '?'): string {
  return p === '+' ? '+' : p === '-' ? '−' : '?';
}

/**
 * Floating "Causal Lens" panel — analogous to Stella's. Click a node in the
 * diagram, see that variable's behaviour over time alongside its causal
 * inputs and downstream effects. Each linked variable is itself clickable,
 * letting the user traverse the causal graph step by step without losing
 * sight of the whole diagram.
 */
export function CausalLens({ fqn, program, result, onSelect, onClose }: CausalLensProps) {
  const sym = useMemo<Symbol | null>(() => program.symbols.byFqn(fqn) ?? null, [program, fqn]);

  // ── Time series (or static value) ────────────────────────────────────────
  const series: Float64Array | null = useMemo(() => {
    if (!result || !sym) return null;
    if (sym.kind === 'stock') return result.stocks[fqn] ?? null;
    if (sym.kind === 'calc') return result.calcs[fqn] ?? null;
    if (sym.kind === 'flow') return result.flows[fqn] ?? null;
    return null;
  }, [result, sym, fqn]);

  // For constants: read the static value off `program.constants` slot.
  const constantValue: number | null = useMemo(() => {
    if (!sym || sym.kind !== 'constant') return null;
    const c = program.constants.find((x) => x.fqn === fqn);
    if (!c) return null;
    const ops = c.expr.ops;
    const op0 = ops[0];
    if (ops.length === 1 && op0 && op0.kind === 'PushNum') return op0.value;
    return null; // computed constant — surfaced as "—" rather than wrong
  }, [program, sym, fqn]);

  // ── Causal neighbours via program.influences[] ──────────────────────────
  const incoming = useMemo(() => {
    if (!sym) return [];
    const out: { fqn: string; polarity: '+' | '-' | '?'; kind: string }[] = [];
    const seen = new Set<string>();
    for (const inf of program.influences) {
      if (inf.target !== sym.id) continue;
      const src = program.symbols.byId(inf.source);
      if (!src || seen.has(src.fqn)) continue;
      seen.add(src.fqn);
      out.push({ fqn: src.fqn, polarity: inf.polarity, kind: src.kind });
    }
    return out;
  }, [program, sym]);

  const outgoing = useMemo(() => {
    if (!sym) return [];
    const out: { fqn: string; polarity: '+' | '-' | '?'; kind: string }[] = [];
    const seen = new Set<string>();
    for (const inf of program.influences) {
      if (inf.source !== sym.id) continue;
      const tgt = program.symbols.byId(inf.target);
      if (!tgt || seen.has(tgt.fqn)) continue;
      seen.add(tgt.fqn);
      out.push({ fqn: tgt.fqn, polarity: inf.polarity, kind: tgt.kind });
    }
    return out;
  }, [program, sym]);

  // For flows: surface the per-flow inputs from program.flowInputs[].
  const flowInputs = useMemo(() => {
    if (!sym || sym.kind !== 'flow') return [];
    const out: { fqn: string; polarity: '+' | '-' | '?' }[] = [];
    const seen = new Set<string>();
    for (const fi of program.flowInputs) {
      if (fi.flow !== sym.id) continue;
      const src = program.symbols.byId(fi.source);
      if (!src || seen.has(src.fqn)) continue;
      seen.add(src.fqn);
      out.push({ fqn: src.fqn, polarity: fi.polarity });
    }
    return out;
  }, [program, sym]);

  if (!sym) {
    return (
      <aside className="lens">
        <header className="lens__head">
          <span className="lens__name">{shortName(fqn)}</span>
          <button className="lens__close" type="button" onClick={onClose} aria-label="Close lens">
            ×
          </button>
        </header>
        <div className="lens__body lens__body--empty">— unknown variable —</div>
      </aside>
    );
  }

  // Sparkline: 240×60 SVG, line + final-value dot.
  const sparkline = renderSparkline(series, sym.kind);

  return (
    <aside className="lens" aria-label={`Causal lens: ${fqn}`}>
      <header className="lens__head">
        <span className={`lens__kind lens__kind--${sym.kind}`}>{sym.kind}</span>
        <span className="lens__name" title={fqn}>{shortName(fqn)}</span>
        <button className="lens__close" type="button" onClick={onClose} aria-label="Close lens">
          ×
        </button>
      </header>

      <div className="lens__body">
        {sparkline && <div className="lens__spark">{sparkline}</div>}
        {constantValue !== null && (
          <div className="lens__const">
            value = <code>{fmt(constantValue)}</code>
          </div>
        )}

        {/* For flows we prefer flowInputs (the SFD-correct view: which sources
            feed the rate). For everything else, the incoming causal arcs. */}
        {(sym.kind === 'flow' ? flowInputs : incoming).length > 0 && (
          <section className="lens__section">
            <h5 className="lens__section-title">Inputs</h5>
            <ul className="lens__list">
              {(sym.kind === 'flow' ? flowInputs : incoming).map((it) => (
                <li key={it.fqn}>
                  <button type="button" className="lens__link" onClick={() => onSelect(it.fqn)}>
                    <span className={`lens__pol lens__pol--${polClass(it.polarity)}`}>
                      {polGlyph(it.polarity)}
                    </span>
                    <code>{shortName(it.fqn)}</code>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {outgoing.length > 0 && (
          <section className="lens__section">
            <h5 className="lens__section-title">Affects</h5>
            <ul className="lens__list">
              {outgoing.map((it) => (
                <li key={it.fqn}>
                  <button type="button" className="lens__link" onClick={() => onSelect(it.fqn)}>
                    <span className={`lens__pol lens__pol--${polClass(it.polarity)}`}>
                      {polGlyph(it.polarity)}
                    </span>
                    <code>{shortName(it.fqn)}</code>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(sym.kind === 'flow' ? flowInputs : incoming).length === 0 && outgoing.length === 0 && (
          <div className="lens__empty">No causal links.</div>
        )}
      </div>
    </aside>
  );
}

function renderSparkline(series: Float64Array | null, kind: string): JSX.Element | null {
  if (!series || series.length < 2) return null;
  const W = 240;
  const H = 56;
  const pad = 4;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < series.length; i++) {
    const v = series[i]!;
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;
  const xScale = (i: number) => pad + (i / (series.length - 1)) * innerW;
  const yScale = (v: number) => pad + innerH - ((v - min) / (max - min)) * innerH;
  const color = kind === 'stock' ? '#0F4C5C' : kind === 'calc' ? '#5C5A55' : '#A0742E';

  let d = `M ${xScale(0)} ${yScale(series[0]!)}`;
  for (let i = 1; i < series.length; i++) {
    if (Number.isFinite(series[i]!)) {
      d += ` L ${xScale(i)} ${yScale(series[i]!)}`;
    }
  }
  const lastIdx = series.length - 1;
  const lastV = series[lastIdx]!;
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="lens__spark-svg"
      role="img"
      aria-label="Time series"
    >
      <path d={d} fill="none" stroke={color} strokeWidth={1.4} />
      <circle cx={xScale(lastIdx)} cy={yScale(lastV)} r={3} fill={color} />
      <text
        x={W - pad}
        y={pad + 9}
        textAnchor="end"
        fontFamily="var(--font-mono)"
        fontSize="10"
        fill={color}
      >
        {fmt(lastV)}
      </text>
      <text
        x={pad}
        y={pad + 9}
        textAnchor="start"
        fontFamily="var(--font-mono)"
        fontSize="9"
        fill="var(--ink-3)"
      >
        {fmt(series[0]!)}
      </text>
    </svg>
  );
}
