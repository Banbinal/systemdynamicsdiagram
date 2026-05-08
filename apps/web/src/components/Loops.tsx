import { Fragment, useCallback, useMemo, useState } from 'react';

import { findLoops, type CompiledProgram, type Loop } from '@sysdyn/core';

import { explainLoop, getStoredApiKey, setStoredApiKey } from '../lib/gemini.ts';

interface LoopsProps {
  readonly program: CompiledProgram | null;
  /** DSL source — handed to the AI explainer alongside the loop structure. */
  readonly source: string;
}

function shortName(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i < 0 ? fqn : fqn.slice(i + 1);
}

function polClass(p: '+' | '-' | '?'): string {
  if (p === '+') return 'pos';
  if (p === '-') return 'neg';
  return 'unk';
}

function polGlyph(p: '+' | '-' | '?'): string {
  if (p === '+') return '+';
  if (p === '-') return '−';
  return '?';
}

type ExplainState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; text: string }
  | { status: 'error'; message: string };

export function Loops({ program, source }: LoopsProps) {
  const loops = useMemo<readonly Loop[]>(() => (program ? findLoops(program) : []), [program]);

  // Per-loop AI explanation state, keyed by loop id. Reset whenever the
  // model recompiles (loop ids may shift, and the cached prose would lie).
  const [explanations, setExplanations] = useState<Record<string, ExplainState>>({});
  const programRef = useMemo(() => program, [program]);
  // useMemo above is just for stable identity reference; reset state on it.
  // (Using useEffect would also work — stick to useMemo so we don't drag a
  // useEffect import.)
  useMemo(() => {
    setExplanations({});
  }, [programRef]);

  const explain = useCallback(
    async (loop: Loop) => {
      let key = getStoredApiKey();
      if (!key) {
        const entered = window.prompt(
          'Paste your Google AI (Gemini) API key.\nIt is stored in your browser only and used to call the Gemini API directly.',
        );
        if (!entered) return;
        key = entered.trim();
        if (!key) return;
        setStoredApiKey(key);
      }
      setExplanations((prev) => ({ ...prev, [loop.id]: { status: 'loading' } }));
      try {
        const text = await explainLoop({
          apiKey: key,
          source,
          loop: {
            id: loop.id,
            kind: loop.kind,
            nodes: loop.nodes,
            edgePolarities: loop.edgePolarities,
          },
        });
        setExplanations((prev) => ({ ...prev, [loop.id]: { status: 'done', text } }));
      } catch (err) {
        setExplanations((prev) => ({
          ...prev,
          [loop.id]: {
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    },
    [source],
  );

  if (!program) {
    return <aside className="loops loops--empty">— compile to detect loops —</aside>;
  }
  if (loops.length === 0) {
    return <aside className="loops loops--empty">No feedback loops detected.</aside>;
  }

  const rCount = loops.filter((l) => l.kind === 'R').length;
  const bCount = loops.filter((l) => l.kind === 'B').length;

  return (
    <aside className="loops" aria-label="Feedback loops">
      <header className="loops__head">
        <h4 className="loops__title">Loops</h4>
        <span className="loops__summary">
          {rCount} R · {bCount} B
        </span>
      </header>
      <ul className="loops__list">
        {loops.map((loop) => {
          const ex = explanations[loop.id] ?? { status: 'idle' };
          return (
            <li key={loop.id} className={`loop loop--${loop.kind === 'R' ? 'r' : 'b'}`}>
              <div className="loop__head">
                <span className={`loop__badge loop__badge--${loop.kind === 'R' ? 'r' : 'b'}`}>
                  {loop.id}
                </span>
                <span className="loop__nature">
                  {loop.kind === 'R' ? 'Reinforcing' : 'Balancing'}
                </span>
                {loop.unknownCount > 0 && (
                  <span
                    className="loop__warn"
                    title="Some edge polarities are uncertain — R/B classification may not hold."
                  >
                    · {loop.unknownCount} ?
                  </span>
                )}
                <button
                  type="button"
                  className="loop__explain-btn"
                  onClick={() => explain(loop)}
                  disabled={ex.status === 'loading'}
                  title="Ask Gemini to explain this loop in 2-3 sentences"
                >
                  {ex.status === 'loading' ? '…' : '💡'}
                </button>
              </div>
              <div className="loop__path">
                {loop.nodes.map((fqn, i) => (
                  <Fragment key={i}>
                    <code className="loop__node">{shortName(fqn)}</code>
                    <span
                      className={`loop__arrow loop__arrow--${polClass(loop.edgePolarities[i]!)}`}
                      aria-label={`polarity ${loop.edgePolarities[i]}`}
                    >
                      {polGlyph(loop.edgePolarities[i]!)}
                    </span>
                  </Fragment>
                ))}
                <code className="loop__node loop__node--close">{shortName(loop.nodes[0]!)}</code>
              </div>
              {ex.status === 'done' && (
                <div className="loop__explain">
                  <span className="loop__explain-label">AI</span>
                  <p className="loop__explain-text">{ex.text}</p>
                </div>
              )}
              {ex.status === 'error' && (
                <div className="loop__explain loop__explain--error" title={ex.message}>
                  <span className="loop__explain-label">AI error</span>
                  <p className="loop__explain-text">{ex.message}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
