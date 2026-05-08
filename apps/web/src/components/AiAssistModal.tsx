import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { generateSdSource } from '../lib/gemini.ts';
import { loadSkillContext } from '../lib/skillContext.ts';

interface AiAssistModalProps {
  readonly onClose: () => void;
  readonly onApply: (source: string) => void;
}

export function AiAssistModal({ onClose, onApply }: AiAssistModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [prompt, setPrompt] = useState('');
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
      setError('Clé API requise.');
      apiKeyRef.current?.focus();
      return;
    }
    if (!desc) {
      setError('Décris le système à modéliser.');
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
      });
      if (!source.trim()) {
        setError('Gemini a renvoyé une réponse vide.');
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
              Assistant IA
            </h2>
            <p className="modal__sub">Génération du modèle avec Gemini 2.5 Flash · BYOK</p>
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            disabled={busy}
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        <div className="modal__body">
          <label className="form-row">
            <span className="form-row__label">Clé API Google Gemini</span>
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
              Obtiens une clé sur{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
              >
                aistudio.google.com/apikey
              </a>
              . La clé n'est ni stockée ni transmise ailleurs : elle reste en mémoire de
              cette fenêtre et est oubliée à la fermeture de la modale.
            </span>
          </label>

          <label className="form-row">
            <span className="form-row__label">Décris le système à modéliser</span>
            <textarea
              ref={promptRef}
              className="form-row__textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onPromptKeyDown}
              placeholder="Ex. : Croissance logistique d'une population de cerfs (capacité 5000), avec mortalité saisonnière de chasse une fois par an."
              rows={6}
              disabled={busy}
            />
            <span className="form-row__hint">Ctrl/Cmd + Entrée pour envoyer.</span>
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
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={submit}
            disabled={busy}
          >
            {busy ? 'Génération…' : 'Générer le modèle'}
          </button>
        </div>
      </div>
    </div>
  );
}
