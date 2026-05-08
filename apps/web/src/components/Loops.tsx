import { Fragment, useMemo } from 'react';

import { findLoops, type CompiledProgram, type Loop } from '@sysdyn/core';

interface LoopsProps {
  readonly program: CompiledProgram | null;
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

export function Loops({ program }: LoopsProps) {
  const loops = useMemo<readonly Loop[]>(() => (program ? findLoops(program) : []), [program]);

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
        {loops.map((loop) => (
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
          </li>
        ))}
      </ul>
    </aside>
  );
}
