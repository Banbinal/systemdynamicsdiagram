import type { Example } from '../examples.ts';
import type { SimStatus } from '../hooks/useSimulation.ts';

interface HeaderProps {
  readonly examples: readonly Example[];
  readonly activeId: string;
  readonly onSelect: (id: string) => void;
  readonly status: SimStatus;
  readonly elapsedMs: number;
  readonly stepCount: number;
  readonly onShare: () => void;
  readonly onExportPdf: () => void;
  readonly isExporting: boolean;
  readonly onOpenDocs: () => void;
  readonly onDownloadSkill: () => void;
}

const STATUS_LABEL: Record<SimStatus, string> = {
  idle:    'idle',
  running: 'compiling',
  ok:      'live',
  error:   'error',
};

export function Header({
  examples,
  activeId,
  onSelect,
  status,
  elapsedMs,
  stepCount,
  onShare,
  onExportPdf,
  isExporting,
  onOpenDocs,
  onDownloadSkill,
}: HeaderProps) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand__mark">S</span>
        <span>SYSDYN</span>
        <span className="brand__sub">System Dynamics Workbench</span>
      </div>

      <div className="header__sep" />

      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          color: 'var(--ink-3)',
        }}
      >
        Model
        <select
          className="model-select"
          value={activeId}
          onChange={(e) => onSelect(e.target.value)}
          aria-label="Select example model"
        >
          {examples.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.title}
            </option>
          ))}
        </select>
      </label>

      <div className="spacer" />

      <span className="status" data-state={status} title={`Last run: ${elapsedMs.toFixed(1)} ms`}>
        <span className="status__dot" />
        <span className="status__label">{STATUS_LABEL[status]}</span>
        {stepCount > 0 && (
          <>
            <span className="status__meta">·</span>
            <span className="status__meta">{stepCount} steps</span>
            <span className="status__meta">·</span>
            <span className="status__meta">{elapsedMs.toFixed(1)}ms</span>
          </>
        )}
      </span>

      <div className="header__sep" />

      <button
        type="button"
        className="btn"
        onClick={onShare}
        title="Copy a shareable link to the clipboard"
      >
        <ShareIcon />
        Share
      </button>

      <button
        type="button"
        className="btn"
        onClick={onExportPdf}
        disabled={isExporting}
        title="Export the current model and simulation as a PDF"
      >
        <DownloadIcon />
        {isExporting ? 'Preparing…' : 'Export PDF'}
      </button>

      <div className="header__sep" />

      <button
        type="button"
        className="btn btn--ghost"
        onClick={onOpenDocs}
        title="Open the documentation"
      >
        <BookIcon />
        Docs
      </button>

      <button
        type="button"
        className="btn btn--ghost"
        onClick={onDownloadSkill}
        title="Download the Claude Code skill bundle as a zip"
      >
        <ZipIcon />
        Skill (.zip)
      </button>
    </header>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
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
