// A plain <textarea> code editor: line numbers, Tab inserts two spaces (Esc then Tab leaves the
// editor), Enter keeps indentation, Ctrl/Cmd+S saves.
import { h, nextId } from './dom.js';
import { ISSUE_LABELS } from './studio-status.js';

const INDENT = '  ';

export class CodeEditor {
  constructor(container, { onInput, onSave, label = 'Pattern code' } = {}) {
    const noop = () => {};
    Object.assign(this, { onInput: onInput || noop, onSave: onSave || noop, escaped: false, lineCount: 0,
      problemLine: 0 });
    const id = nextId('code');
    this.gutter = h('div', { class: 'gutter', 'aria-hidden': 'true' });
    this.ta = h('textarea', { id, class: 'code', spellcheck: false, wrap: 'off', autocapitalize: 'off',
      autocomplete: 'off', autocorrect: 'off', 'aria-describedby': `${id}-help ${id}-problem`, 'data-gramm': 'false' });
    this.problem = h('div', { id: `${id}-problem`, class: 'problem', role: 'status', 'aria-live': 'polite',
      hidden: true });
    const help = 'Tab inserts spaces. Press Escape, then Tab, to move focus out of the editor.';
    this.el = h('div', { class: 'editor' }, h('label', { for: id, class: 'sr-only', text: label }),
      h('div', { class: 'editor-scroll' }, this.gutter, this.ta), this.problem,
      h('p', { id: `${id}-help`, class: 'sr-only', text: help }));
    container.append(this.el);

    this.ta.addEventListener('input', () => { this._lines(); this.onInput(this.ta.value); });
    this.ta.addEventListener('scroll', () => { this.gutter.scrollTop = this.ta.scrollTop; });
    this.ta.addEventListener('keydown', (e) => this._key(e));
    this.ta.addEventListener('blur', () => { this.escaped = false; });
  }

  get value() { return this.ta.value; }

  setValue(code) {
    if (this.ta.value !== code) {
      this.ta.value = code;
      this.ta.scrollTop = 0;
      this.ta.scrollLeft = 0;
    }
    this._lines();
  }

  setDisabled(disabled, placeholder = '') { Object.assign(this.ta, { disabled, placeholder }); }
  focus() { this.ta.focus(); }

  /** problem: null | { kind: 'compile'|'runtime'|'hung', message, line? } */
  setProblem(problem) {
    const line = problem ? (problem.line || findLine(problem.message)) : 0;
    this.problem.hidden = !problem;
    this.problem.replaceChildren();
    if (problem) {
      this.problem.dataset.kind = problem.kind;
      const label = ISSUE_LABELS[problem.kind] || 'Problem';
      const msg = problem.message || '';
      const where = line && !/\bline \d+/i.test(msg) ? ` (line ${line})` : '';
      const note = ' — the model keeps showing the last version that worked.';
      this.problem.append(h('strong', { text: `${label}${where}: ` }), h('span', { text: msg }),
        problem.running ? h('span', { class: 'problem-note', text: note }) : '');
    }
    if (line !== this.problemLine) {
      this.problemLine = line;
      this._markLine();
    }
  }

  /** Insert text at the cursor (used by the quick reference). */
  insert(text) { this.ta.focus(); insertText(this.ta, text); }

  _lines() {
    const n = (this.ta.value.match(/\n/g) || []).length + 1;
    if (n === this.lineCount) return;
    this.lineCount = n;
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= n; i++) frag.append(h('div', { text: String(i) }));
    this.gutter.replaceChildren(frag);
    this._markLine();
  }

  _markLine() {
    for (const el of this.gutter.querySelectorAll('.err')) el.classList.remove('err');
    if (this.problemLine && this.gutter.children[this.problemLine - 1]) {
      this.gutter.children[this.problemLine - 1].classList.add('err');
    }
  }

  _key(e) {
    const ta = this.ta;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.onSave(); return; }
    if (e.key === 'Escape') { this.escaped = true; return; }
    if (e.key === 'Tab') {
      if (this.escaped || e.ctrlKey || e.altKey || e.metaKey) { this.escaped = false; return; } // focus moves on
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end, value } = ta;
      const multi = value.slice(s, end).includes('\n');
      if (!multi && !e.shiftKey) { insertText(ta, INDENT); return; }
      // indent / outdent every selected line
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const out = value.slice(lineStart, end).split('\n')
        .map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, '') : INDENT + l)).join('\n');
      ta.setSelectionRange(lineStart, end);
      insertText(ta, out);
      ta.setSelectionRange(lineStart, lineStart + out.length);
      return;
    }
    this.escaped = false;
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
      const { selectionStart: s, value } = ta;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const indent = /^[ \t]*/.exec(value.slice(lineStart, s))[0];
      const before = value.slice(lineStart, s).trimEnd();
      const extra = /[{([]$/.test(before) ? INDENT : '';
      if (indent || extra) {
        e.preventDefault();
        insertText(ta, '\n' + indent + extra);
      }
    }
  }
}

/** Insert keeping the browser's undo stack when possible. */
function insertText(ta, text) {
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
  if (!ok) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** Pull a line number out of an error message, if it has one. */
export function findLine(msg) {
  if (!msg) return 0;
  const m = /\bline (\d+)/i.exec(msg) || /<anonymous>:(\d+):\d+/.exec(msg)
    || /:(\d+):(\d+)\)?\s*$/.exec(msg);
  return m ? +m[1] : 0;
}
