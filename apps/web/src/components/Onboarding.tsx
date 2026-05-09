import { useEffect, useState } from 'react';

const STORAGE_KEY = 'sysdyn:onboarding-seen-v1';

/** Bumped if the tour content changes meaningfully — users who already saw v1
 *  will see v2 once. The number is part of the storage key so we don't have to
 *  manage migrations. */
export const ONBOARDING_VERSION = 1;

interface OnboardingProps {
  readonly onClose: () => void;
}

interface Step {
  readonly title: string;
  readonly subtitle: string;
  readonly body: React.ReactNode;
}

const STEPS: readonly Step[] = [
  {
    title: 'Welcome to SYSDYN',
    subtitle: '1 of 5 · what this is',
    body: (
      <>
        <p className="modal__para">
          A System Dynamics workbench in your browser — describe a system as
          stocks, flows, and feedback loops, and watch it simulate live as you
          type. No install, no server.
        </p>
        <ul className="onboarding__list">
          <li>
            <strong>Pick an example</strong> from the <em>Model</em> dropdown
            in the header to follow along — Simple Population is a good start.
          </li>
          <li>
            Use <kbd>←</kbd> <kbd>→</kbd> to move through this tour, or
            <kbd>Esc</kbd> to skip.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Write the model on the left',
    subtitle: '2 of 5 · the source editor',
    body: (
      <>
        <p className="modal__para">
          A small DSL with five primitives: <code>stock</code>,{' '}
          <code>flow</code>, <code>calc</code>, <code>const</code>,{' '}
          <code>module</code>. Errors and warnings appear inline; the right
          pane recompiles within ~200&nbsp;ms of every keystroke.
        </p>
        <ul className="onboarding__list">
          <li>
            <strong>Live diagnostics</strong> — red/amber strip above the
            editor lists every issue, click to jump to the line.
          </li>
          <li>
            <strong>AI assist</strong> — the ✨ button generates DSL from a
            plain-English description (bring your own Gemini key).
          </li>
          <li>
            <strong>Drag the divider</strong> between the two panes to resize;
            double-click to reset.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'See it as a diagram',
    subtitle: '3 of 5 · the Model tab',
    body: (
      <>
        <p className="modal__para">
          The <strong>Model</strong> tab renders a stock-and-flow diagram with
          live polarity arrows, gauges on each stock, and an animated matter
          flow when the simulation plays.
        </p>
        <ul className="onboarding__list">
          <li>
            <strong>Loops sidebar</strong> — every detected feedback loop
            classified <span className="onboarding__pill onboarding__pill--r">R</span>{' '}
            (reinforcing) or{' '}
            <span className="onboarding__pill onboarding__pill--b">B</span>{' '}
            (balancing). Click one for an AI-generated plain-language
            explanation.
          </li>
          <li>
            <strong>Time scrubber</strong> — press play to step through the
            run; the dominant loop highlights as time advances.
          </li>
          <li>
            <strong>CLD toggle</strong> collapses the diagram to a pure causal
            arc graph when you only care about cause-and-effect.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Simulate & tweak live',
    subtitle: '4 of 5 · the Simulation tab',
    body: (
      <>
        <p className="modal__para">
          The <strong>Simulation</strong> tab plots every stock over time. Drag
          a slider in the <em>Live tweak</em> panel and the chart redraws
          instantly — the SyntheSim experience from Stella, in a tab.
        </p>
        <ul className="onboarding__list">
          <li>
            <strong>Phase plot</strong> — toggle to view one stock against
            another in state space (great for spotting limit cycles).
          </li>
          <li>
            <strong>Reference modes</strong> — if your DSL declares a{' '}
            <code>reference</code> block, your expected curve is overlaid as a
            dashed guide.
          </li>
          <li>
            <strong>Legend</strong> — click a series name to hide/show it on
            the chart.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Go further · share & export',
    subtitle: '5 of 5 · advanced tabs and outputs',
    body: (
      <>
        <p className="modal__para">
          Declare extras in your DSL and matching tabs unlock automatically:
        </p>
        <ul className="onboarding__list">
          <li>
            <code>scenario</code> / <code>sweep</code> →{' '}
            <strong>Compare</strong> tab for side-by-side runs.
          </li>
          <li>
            <code>sweep</code> → <strong>Sensitivity</strong> tab with a
            tornado chart, sorted by amplitude.
          </li>
          <li>
            <code>check</code> → <strong>Checks</strong> tab — assertion-based
            reality checks à la Vensim DSS.
          </li>
          <li>
            <code>calibrate</code> → <strong>Calibrate</strong> tab fits free
            constants to reference data via Nelder-Mead.
          </li>
        </ul>
        <p className="modal__para">
          The header has buttons for everything else: <strong>Share</strong>{' '}
          (the entire model is encoded in a signed URL — no server),{' '}
          <strong>Export PDF</strong>, <strong>XMILE import/export</strong>{' '}
          (Stella, Vensim, Insight Maker), and <strong>Docs</strong> for the
          full reference.
        </p>
      </>
    ),
  },
];

/**
 * First-run product tour — five lightweight slides covering every major
 * surface in the workbench. Persisted via `localStorage` so it shows once;
 * the header's "Tour" button reopens it on demand.
 *
 * Skipped in embed mode and when a share token is already in the URL hash
 * (the user came via a shared link and almost certainly just wants to play
 * with the model, not learn the editor).
 */
export function Onboarding({ onClose }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const last = STEPS.length - 1;

  // Mark seen on close so the tour does not reappear on next load. We mark on
  // mount-then-unmount via the close handler; a user who reloads mid-tour
  // sees it again, which is fine.

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setStep((s) => Math.min(last, s + 1));
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, last]);

  const current = STEPS[step]!;
  const isLast = step === last;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal onboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <div>
            <h2 className="modal__title" id="onboarding-title">
              {current.title}
            </h2>
            <p className="modal__sub">{current.subtitle}</p>
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close tour"
          >
            ×
          </button>
        </div>

        <div className="modal__body onboarding__body">{current.body}</div>

        <div className="modal__foot onboarding__foot">
          <div className="onboarding__dots" aria-hidden="true">
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                className={
                  'onboarding__dot' +
                  (i === step ? ' onboarding__dot--on' : '') +
                  (i < step ? ' onboarding__dot--past' : '')
                }
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>
          <div className="spacer" />
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            Back
          </button>
          {isLast ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={onClose}
            >
              Get started
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setStep((s) => Math.min(last, s + 1))}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Read whether the user has already seen the tour. SSR-safe. */
export function hasSeenOnboarding(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === String(ONBOARDING_VERSION);
  } catch {
    return true;
  }
}

/** Stamp the current onboarding version as seen. */
export function markOnboardingSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(ONBOARDING_VERSION));
  } catch {
    /* localStorage disabled — fine, the tour will reappear next visit */
  }
}
