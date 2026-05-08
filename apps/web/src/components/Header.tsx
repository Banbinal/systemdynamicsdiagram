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
