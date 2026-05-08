import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

import type { CompiledProgram } from '@sysdyn/core';
import { programToMermaid } from '../lib/programToMermaid.ts';

let initialized = false;
function ensureMermaid() {
  if (initialized) return;
  initialized = true;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'base',
    flowchart: { curve: 'basis', htmlLabels: false, padding: 12 },
    themeVariables: {
      fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
      fontSize: '13px',
      primaryColor: '#FFFFFF',
      primaryTextColor: '#1F1F1F',
      primaryBorderColor: '#1F1F1F',
      lineColor: '#5C5A55',
      secondaryColor: '#F4EFE6',
      tertiaryColor: '#FAFAF9',
      mainBkg: '#FFFFFF',
      nodeBkg: '#FFFFFF',
      clusterBkg: '#FAFAF9',
      clusterBorder: '#D4D1CB',
      titleColor: '#1F1F1F',
      edgeLabelBackground: '#FFFFFF',
    },
  });
}

let renderSeq = 0;

interface DiagramProps {
  readonly program: CompiledProgram | null;
}

export function Diagram({ program }: DiagramProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureMermaid();
    if (!program || !ref.current) return;

    const source = programToMermaid(program);
    const id = `sd-diagram-${++renderSeq}`;
    let cancelled = false;

    mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [program]);

  if (!program) {
    return <div className="diagram-empty">— compile a model to see its diagram —</div>;
  }
  if (error) {
    return (
      <div className="diagram-error">
        <strong>Mermaid error</strong>
        <pre>{error}</pre>
      </div>
    );
  }
  return <div ref={ref} className="diagram-host" aria-label="Stock-and-flow diagram" />;
}
