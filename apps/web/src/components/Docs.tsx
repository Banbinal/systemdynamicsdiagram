import { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';

interface DocsProps {
  readonly onClose: () => void;
  readonly onDownload: () => void;
}

interface Section {
  readonly id: string;
  readonly title: string;
  readonly path: string;   // path under public/skill/, e.g. 'SKILL.md'
  readonly blurb: string;
}

const SECTIONS: readonly Section[] = [
  {
    id: 'overview',
    title: 'Overview',
    path: 'SKILL.md',
    blurb: 'Workflow, syntax surface, hand-off rules.',
  },
  {
    id: 'grammar',
    title: 'Grammar',
    path: 'references/grammar.md',
    blurb: 'Full DSL reference — every keyword, error code, indentation rule.',
  },
  {
    id: 'patterns',
    title: 'Patterns',
    path: 'references/patterns.md',
    blurb: 'Recipes for common modeling moves: feedback loops, delays, capacitated growth.',
  },
  {
    id: 'examples',
    title: 'Examples',
    path: 'references/examples.md',
    blurb: 'Three annotated end-to-end examples to copy structurally.',
  },
];

const BASE = import.meta.env.BASE_URL;

// `marked` v14 returns a Promise when `async: true` is set, but its sync mode
// is fine for static markdown — we don't use any async extensions here.
marked.setOptions({ async: false, gfm: true, breaks: false });

// Strip the YAML frontmatter that the SKILL.md file starts with — it's
// metadata for Claude Code, not part of the doc the user wants to read.
function stripFrontmatter(md: string): string {
  if (!md.startsWith('---')) return md;
  const end = md.indexOf('\n---', 3);
  if (end < 0) return md;
  const after = md.indexOf('\n', end + 4);
  return md.slice(after + 1);
}

export function Docs({ onClose, onDownload }: DocsProps) {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0]!.id);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      SECTIONS.map(async (s) => {
        try {
          const res = await fetch(`${BASE}skill/${s.path}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return [s.id, await res.text(), null] as const;
        } catch (err) {
          return [s.id, '', err instanceof Error ? err.message : String(err)] as const;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const ok: Record<string, string> = {};
      const err: Record<string, string> = {};
      for (const [id, src, e] of results) {
        if (e) err[id] = e;
        else ok[id] = src;
      }
      setSources(ok);
      setErrors(err);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0]!;

  const html = useMemo(() => {
    const raw = sources[active.id];
    if (raw === undefined) return null;
    const cleaned = active.id === 'overview' ? stripFrontmatter(raw) : raw;
    return marked.parse(cleaned) as string;
  }, [sources, active]);

  return (
    <div className="docs">
      <header className="docs__head">
        <div className="brand">
          <span className="brand__mark">S</span>
          <span>SYSDYN</span>
          <span className="brand__sub">Documentation</span>
        </div>

        <div className="spacer" />

        <button
          type="button"
          className="btn"
          onClick={onDownload}
          title="Download the Claude Code skill bundle as a zip"
        >
          <ZipIcon />
          Download skill (.zip)
        </button>

        <button
          type="button"
          className="btn"
          onClick={onClose}
          title="Back to the workbench"
        >
          <BackIcon />
          Back to workbench
        </button>
      </header>

      <div className="docs__main">
        <nav className="docs__nav" aria-label="Documentation sections">
          <div className="docs__nav-title">Contents</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={'docs__nav-item' + (s.id === activeId ? ' is-active' : '')}
              onClick={() => setActiveId(s.id)}
            >
              <span className="docs__nav-name">{s.title}</span>
              <span className="docs__nav-blurb">{s.blurb}</span>
            </button>
          ))}

          <div className="docs__nav-foot">
            <p>
              These pages are the Claude Code skill bundled with this app.
              Download the zip and drop it in <code>~/.claude/skills/</code> to
              let Claude write models for you and hand back signed share links.
            </p>
          </div>
        </nav>

        <main className="docs__content">
          {errors[active.id] && (
            <div className="docs__error">
              Failed to load <code>{active.path}</code>: {errors[active.id]}
            </div>
          )}
          {html === null && !errors[active.id] && (
            <div className="docs__loading">Loading…</div>
          )}
          {html !== null && (
            <article
              className="markdown"
              // Content is our own static skill markdown — not user input.
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function ZipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="10" y1="14" x2="14" y2="14" />
    </svg>
  );
}
