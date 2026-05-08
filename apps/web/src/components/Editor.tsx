import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { keymap, EditorView } from '@codemirror/view';

import { sdLanguage } from '../lib/sdLanguage.ts';
import { sdTheme } from '../lib/sdTheme.ts';

interface EditorProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onAiAssist?: () => void;
}

/** Minimal CodeMirror 6 extension stack — only what's needed. */
const extensions = [
  history(),
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  bracketMatching(),
  indentOnInput(),
  EditorView.lineWrapping,
  keymap.of([...defaultKeymap, ...historyKeymap]),
  sdLanguage,
  ...sdTheme,
];

export function Editor({ value, onChange, onAiAssist }: EditorProps) {
  // Stable extension array — recreating on every render trips CodeMirror's plugin reconciliation.
  const ext = useMemo(() => extensions, []);
  return (
    <div className="editor-host">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={ext}
        theme="light"
        basicSetup={false}
        height="100%"
        style={{ height: '100%' }}
      />
      {onAiAssist && (
        <button
          type="button"
          className="editor-ai-btn"
          onClick={onAiAssist}
          title="Générer un modèle avec Gemini Flash"
          aria-label="Assistant IA"
        >
          <SparkleIcon />
          <span>IA</span>
        </button>
      )}
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 15.8l-1.8-4.6L6 9.4l4.2-1.8z" />
      <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z" />
    </svg>
  );
}
