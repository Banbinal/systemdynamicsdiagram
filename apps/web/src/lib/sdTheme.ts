import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/** Light theme that hooks into our pro palette via CSS variables. */
const editorTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--ink-1)',
      backgroundColor: 'transparent',
      fontFamily: 'var(--font-mono)',
      fontSize: '13px',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: 'inherit',
      lineHeight: '1.6',
    },
    '.cm-content': {
      caretColor: 'var(--accent)',
      padding: '12px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent)',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground':
      {
        backgroundColor: 'var(--selection)',
      },
    '.cm-activeLine': {
      backgroundColor: 'var(--active-line)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--active-line)',
      color: 'var(--ink-2)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--surface-2)',
      color: 'var(--ink-3)',
      border: 'none',
      borderRight: '1px solid var(--border)',
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 12px 0 12px',
      minWidth: '40px',
    },
    '.cm-foldGutter .cm-gutterElement': {
      color: 'var(--ink-3)',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'var(--match)',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--border)',
      color: 'var(--ink-1)',
      fontFamily: 'var(--font-mono)',
    },
  },
  { dark: false },
);

/** Pro-light syntax colors. */
const editorHighlight = HighlightStyle.define([
  { tag: t.lineComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.keyword,     color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: t.atom,        color: 'var(--syn-atom)',    fontWeight: '500' },
  { tag: t.meta,        color: 'var(--syn-meta)',    fontWeight: '500' },
  { tag: t.standard(t.variableName), color: 'var(--syn-builtin)' },
  { tag: t.number,      color: 'var(--syn-number)' },
  { tag: t.operator,    color: 'var(--syn-operator)' },
  { tag: t.punctuation, color: 'var(--syn-punct)' },
  { tag: t.propertyName, color: 'var(--syn-prop)' },
  { tag: t.variableName, color: 'var(--ink-1)' },
]);

export const sdTheme = [editorTheme, syntaxHighlighting(editorHighlight)];
