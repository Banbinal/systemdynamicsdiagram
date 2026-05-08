import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { generateSdSource, type GenerateMode } from '../lib/gemini.ts';
import { loadSkillContext } from '../lib/skillContext.ts';

interface AiAssistModalProps {
  readonly currentSource: string;
  readonly onClose: () => void;
  readonly onApply: (source: string) => void;
}

export function AiAssistModal({ currentSource, onClose, onApply }: AiAssistModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<GenerateMode>('create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiKeyRef = useRef<HTMLInputElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    apiKeyRef.current?.focus();
  }, []);

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
    const desc = prompt.trim();
    if (!key) {
      setError('API key required.');
      apiKeyRef.current?.focus();
      return;
    }
    if (!desc) {
      setError(
        mode === 'modify'
          ? 'Describe the change you want.'
          : 'Describe the system to model.',
      );
      promptRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const skill = await loadSkillContext();
      const source = await generateSdSource({
        apiKey: key,
        userPrompt: desc,
        skillContext: skill,
        mode,
        ...(mode === 'modify' ? { currentSource } : {}),
      });
      if (!source.trim()) {
        setError('Gemini returned an empty response.');
        return;
      }
      onApply(source);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onPromptKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  const promptLabel =
    mode === 'modify' ? 'Describe the change' : 'Describe the system to model';
  const promptPlaceholder =
    mode === 'modify'
      ? 'e.g. Raise the carrying capacity to 8000 and add a hunting scenario that activates at year 20.'
      : "e.g. Logistic deer population (carrying capacity 5000) with a yearly hunting season that culls 8% of the herd.";

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
        aria-labelledby="ai-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <div>
            <h2 className="modal__title" id="ai-modal-title">
              AI Assistant
            </h2>
            <p className="modal__sub">Generate a model with Gemini 2.5 Flash · BYOK</p>
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
          <div className="form-row">
            <span className="form-row__label">Mode</span>
            <div
              className="segmented"
              role="radiogroup"
              aria-label="Generation mode"
            >
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'create'}
                className={
                  'segmented__opt' + (mode === 'create' ? ' segmented__opt--on' : '')
                }
                onClick={() => setMode('create')}
                disabled={busy}
              >
                Create new model
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'modify'}
                className={
                  'segmented__opt' + (mode === 'modify' ? ' segmented__opt--on' : '')
                }
                onClick={() => setMode('modify')}
                disabled={busy}
              >
                Modify existing model
              </button>
            </div>
            <span className="form-row__hint">
              {mode === 'modify'
                ? 'The current editor source is sent as context. Gemini returns a full updated source.'
                : 'Gemini drafts a brand-new .sd source from your description.'}
            </span>
          </div>

          <label className="form-row">
            <span className="form-row__label">Google Gemini API key</span>
            <input
              ref={apiKeyRef}
              type="password"
              className="form-row__input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
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
              . The key is neither stored nor sent anywhere else: it lives only in
              this dialog and is forgotten when the modal closes.
            </span>
          </label>

          <label className="form-row">
            <span className="form-row__label">{promptLabel}</span>
            <textarea
              ref={promptRef}
              className="form-row__textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onPromptKeyDown}
              placeholder={promptPlaceholder}
              rows={6}
              disabled={busy}
            />
            <span className="form-row__hint">Ctrl/Cmd + Enter to submit.</span>
          </label>

          {error && (
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
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={submit}
            disabled={busy}
          >
            {busy ? 'Generating…' : mode === 'modify' ? 'Apply change' : 'Generate model'}
          </button>
        </div>
      </div>
    </div>
  );
}
