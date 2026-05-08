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

export function Editor({ value, onChange }: EditorProps) {
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
    </div>
  );
}
