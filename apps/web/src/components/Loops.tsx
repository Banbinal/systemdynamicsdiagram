import { Fragment, useEffect, useMemo, useState } from 'react';

import { findLoops, type CompiledProgram, type Loop } from '@sysdyn/core';

import { LoopExplainModal, type LoopExplainState } from './LoopExplainModal.tsx';
import { SparkleIcon } from './SparkleIcon.tsx';

interface LoopsProps {
  readonly program: CompiledProgram | null;
  /** DSL source — handed to the AI explainer alongside the loop structure. */
  readonly source: string;
  /** ID of the loop currently dominant in the diagram (synchronised with
   *  the scrubber). Receives a "dominant" badge in the list. */
  readonly dominantLoopId?: string | null;
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

export function Loops({ program, source, dominantLoopId }: LoopsProps) {
  const loops = useMemo<readonly Loop[]>(() => (program ? findLoops(program) : []), [program]);

  // Per-loop AI explanation state, keyed by loop id. Reset whenever the
  // program identity changes (loop ids may shift, and cached prose would lie).
  const [explanations, setExplanations] = useState<Record<string, LoopExplainState>>({});
  useEffect(() => {
    setExplanations({});
    setOpenLoopId(null);
  }, [program]);

  const [openLoopId, setOpenLoopId] = useState<string | null>(null);

  if (!program) {
    return <aside className="loops loops--empty">— compile to detect loops —</aside>;
  }
  if (loops.length === 0) {
    return <aside className="loops loops--empty">No feedback loops detected.</aside>;
  }

  const rCount = loops.filter((l) => l.kind === 'R').length;
  const bCount = loops.filter((l) => l.kind === 'B').length;
  const openLoop = openLoopId ? loops.find((l) => l.id === openLoopId) ?? null : null;

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
          const isDominant = dominantLoopId === loop.id;
          return (
            <li
              key={loop.id}
              className={`loop loop--${loop.kind === 'R' ? 'r' : 'b'}` + (isDominant ? ' loop--dominant' : '')}
            >
              <div className="loop__head">
                <span className={`loop__badge loop__badge--${loop.kind === 'R' ? 'r' : 'b'}`}>
                  {loop.id}
                </span>
                <span className="loop__nature">
                  {loop.kind === 'R' ? 'Reinforcing' : 'Balancing'}
                </span>
                {isDominant && (
                  <span className="loop__dominant" title="Most active loop at the current scrubber time">
                    dominant
                  </span>
                )}
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
                  className="ai-btn ai-btn--sm loop__ai-btn"
                  onClick={() => setOpenLoopId(loop.id)}
                  title="Explain this loop with Gemini"
                  aria-label={`Explain loop ${loop.id} with AI`}
                >
                  <SparkleIcon size={11} />
                  <span>AI</span>
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

      {openLoop && (
        <LoopExplainModal
          loop={openLoop}
          source={source}
          initialState={explanations[openLoop.id] ?? { status: 'idle' }}
          onClose={() => setOpenLoopId(null)}
          onState={(next) =>
            setExplanations((prev) => ({ ...prev, [openLoop.id]: next }))
          }
        />
      )}
    </aside>
  );
}
