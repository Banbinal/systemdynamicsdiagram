import { Fragment, useEffect, useRef, useState } from 'react';

import type { Loop } from '@sysdyn/core';

import {
  explainLoop,
  getStoredApiKey,
  setStoredApiKey,
} from '../lib/gemini.ts';

export type LoopExplainState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; text: string }
  | { status: 'error'; message: string };

interface LoopExplainModalProps {
  readonly loop: Loop;
  readonly source: string;
  readonly initialState: LoopExplainState;
  readonly onClose: () => void;
  readonly onState: (next: LoopExplainState) => void;
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

/**
 * Modal that explains a single feedback loop in plain language via Gemini.
 * Mirrors the chrome of `AiAssistModal` (same .modal* CSS classes, same API
 * key handling, same Cmd/Ctrl+Enter shortcut) so the two modals read as
 * variants of one component family. The fetched explanation is cached by the
 * caller via `onState`, so reopening the modal for an already-explained loop
 * shows the cached prose instantly.
 */
export function LoopExplainModal({
  loop,
  source,
  initialState,
  onClose,
  onState,
}: LoopExplainModalProps) {
  const [apiKey, setApiKey] = useState(() => getStoredApiKey());
  const [state, setState] = useState<LoopExplainState>(initialState);
  const [error, setError] = useState<string | null>(
    initialState.status === 'error' ? initialState.message : null,
  );

  const apiKeyRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // If the cached state already has a result, surface that on open and
    // keep focus near the close action; otherwise focus the API key.
    if (initialState.status !== 'done') apiKeyRef.current?.focus();
  }, [initialState.status]);

  const busy = state.status === 'loading';

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const submit = async () => {
    setError(null);
    const key = apiKey.trim();
    if (!key) {
      setError('API key required.');
      apiKeyRef.current?.focus();
      return;
    }
    setStoredApiKey(key);
    const next: LoopExplainState = { status: 'loading' };
    setState(next);
    onState(next);
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
      const done: LoopExplainState = { status: 'done', text };
      setState(done);
      onState(done);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failed: LoopExplainState = { status: 'error', message: msg };
      setState(failed);
      onState(failed);
      setError(msg);
    }
  };

  const onKeyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  const submitLabel =
    state.status === 'loading'
      ? 'Asking…'
      : state.status === 'done'
        ? 'Re-explain'
        : 'Explain this loop';

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loop-explain-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <div>
            <h2 className="modal__title" id="loop-explain-title">
              Explain loop {loop.id}
            </h2>
            <p className="modal__sub">Gemini 2.5 Flash · BYOK</p>
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="modal__body">
          <p className="modal__para">
            Ask Gemini to explain this {loop.kind === 'R' ? 'reinforcing' : 'balancing'} loop in 2-3 sentences. The model
            source and the cycle's polarity sequence are sent as context — no other data leaves your browser.
          </p>

          <div className="form-row">
            <span className="form-row__label">Loop</span>
            <div className="loop-explain__cycle">
              <span
                className={`loop__badge loop__badge--${loop.kind === 'R' ? 'r' : 'b'}`}
              >
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
            <div className="loop__path loop-explain__path">
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
              <code className="loop__node loop__node--close">
                {shortName(loop.nodes[0]!)}
              </code>
            </div>
          </div>

          <label className="form-row">
            <span className="form-row__label">Google Gemini API key</span>
            <input
              ref={apiKeyRef}
              type="password"
              className="form-row__input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={onKeyKeyDown}
              placeholder="AIza..."
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <span className="form-row__hint">
              Get a key at{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
              >
                aistudio.google.com/apikey
              </a>
              . Stored in your browser only. Ctrl/Cmd + Enter to submit.
            </span>
          </label>

          {state.status === 'done' && (
            <div className="loop__explain loop-explain__result">
              <span className="loop__explain-label">AI</span>
              <p className="loop__explain-text">{state.text}</p>
            </div>
          )}

          {error && state.status !== 'done' && (
            <div className="modal__error" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="modal__foot">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={submit}
            disabled={busy}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
