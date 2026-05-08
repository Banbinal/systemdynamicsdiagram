import { useCallback, useMemo } from 'react';

import type { CompiledProgram } from '@sysdyn/core';

interface TweakProps {
  readonly program: CompiledProgram | null;
  /**
   * Per-FQN value override. Constants not present here use their compiled
   * default. Mutated via `onChange` whenever the user drags a slider.
   */
  readonly overrides: Readonly<Record<string, number>>;
  readonly onChange: (next: Readonly<Record<string, number>>) => void;
  /**
   * Default values per constant (i.e. what `simulate` would pick with no
   * override). Used to render the slider range and the "modified" indicator.
   */
  readonly defaults: Readonly<Record<string, number>>;
}

function shortName(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i < 0 ? fqn : fqn.slice(i + 1);
}

function moduleOf(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i < 0 ? '' : fqn.slice(0, i);
}

/**
 * Pick a sensible (min, max, step) for a slider given the constant's compiled
 * default. The heuristic is conservative — covers 0..2× the default value, or
 * 0..1 for zero defaults, or symmetric around 0 for negatives. Users wanting
 * a wider range can drag the slider to either bound and we extend on the fly
 * (see `effectiveBounds` below).
 */
function defaultBounds(value: number): { min: number; max: number; step: number } {
  if (value === 0) return { min: 0, max: 1, step: 0.01 };
  if (value > 0) {
    const max = value * 2;
    return { min: 0, max, step: pickStep(max) };
  }
  const min = value * 2;
  return { min, max: 0, step: pickStep(-min) };
}

function pickStep(span: number): number {
  // Step ≈ span / 200 rounded to a "nice" decimal so the readout stays clean.
  const raw = span / 200;
  if (raw === 0) return 0.01;
  const exp = Math.floor(Math.log10(raw));
  const pow = Math.pow(10, exp);
  const m = raw / pow;
  const niceM = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return niceM * pow;
}

function formatValue(v: number): string {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000 || abs < 0.01) return v.toPrecision(3);
  return v.toFixed(Math.max(0, 3 - Math.floor(Math.log10(abs))));
}

export function Tweak({ program, overrides, onChange, defaults }: TweakProps) {
  // Build a stable, grouped list of constants. Sorting is by module then by
  // declaration order (which compile.ts already enforced).
  const groups = useMemo(() => {
    if (!program) return [] as { module: string; items: { fqn: string }[] }[];
    const byModule = new Map<string, { fqn: string }[]>();
    for (const c of program.constants) {
      const mod = moduleOf(c.fqn);
      let arr = byModule.get(mod);
      if (!arr) {
        arr = [];
        byModule.set(mod, arr);
      }
      arr.push({ fqn: c.fqn });
    }
    return [...byModule.entries()].map(([module, items]) => ({ module, items }));
  }, [program]);

  const setOne = useCallback(
    (fqn: string, value: number) => {
      onChange({ ...overrides, [fqn]: value });
    },
    [overrides, onChange],
  );

  const resetOne = useCallback(
    (fqn: string) => {
      const next = { ...overrides };
      delete next[fqn];
      onChange(next);
    },
    [overrides, onChange],
  );

  const resetAll = useCallback(() => onChange({}), [onChange]);

  const modifiedCount = Object.keys(overrides).length;

  if (!program) {
    return <aside className="tweak tweak--empty">— compile to tweak —</aside>;
  }
  if (program.constants.length === 0) {
    return <aside className="tweak tweak--empty">No constants to tweak.</aside>;
  }

  return (
    <aside className="tweak" aria-label="Live constant tweaks">
      <header className="tweak__head">
        <h4 className="tweak__title">Live tweak</h4>
        {modifiedCount > 0 && (
          <button type="button" className="tweak__reset-all" onClick={resetAll}>
            Reset all ({modifiedCount})
          </button>
        )}
      </header>
      <div className="tweak__list">
        {groups.map((group) => (
          <div key={group.module || '(root)'} className="tweak__group">
            {group.module && <div className="tweak__group-label">{group.module}</div>}
            {group.items.map(({ fqn }) => {
              const def = defaults[fqn] ?? 0;
              const cur = overrides[fqn] ?? def;
              const modified = fqn in overrides;
              // Effective bounds: extend if the current value pushes past the
              // default heuristic so the slider never clips silently.
              const base = defaultBounds(def);
              const min = Math.min(base.min, cur);
              const max = Math.max(base.max, cur);
              const step = base.step;
              return (
                <div
                  key={fqn}
                  className={'tweak__row' + (modified ? ' tweak__row--mod' : '')}
                >
                  <div className="tweak__label-row">
                    <code className="tweak__name" title={fqn}>
                      {shortName(fqn)}
                    </code>
                    <span className="tweak__value">{formatValue(cur)}</span>
                    {modified && (
                      <button
                        type="button"
                        className="tweak__reset"
                        onClick={() => resetOne(fqn)}
                        title={`Reset to ${formatValue(def)}`}
                        aria-label={`Reset ${shortName(fqn)}`}
                      >
                        ↺
                      </button>
                    )}
                  </div>
                  <input
                    type="range"
                    className="tweak__slider"
                    min={min}
                    max={max}
                    step={step}
                    value={cur}
                    onChange={(e) => setOne(fqn, parseFloat(e.target.value))}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
