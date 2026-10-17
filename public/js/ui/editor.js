// A plain <textarea> code editor: monospace, line numbers, Tab inserts two spaces
// (Esc then Tab leaves the editor), Enter keeps indentation, Ctrl/Cmd+S saves.
import { h, nextId } from './dom.js';

const INDENT = '  ';

export class CodeEditor {
  constructor(container, { onInput, onSave, label = 'Pattern code' } = {}) {
    this.onInput = onInput || (() => {});
    this.onSave = onSave || (() => {});
    this.escaped = false;
    this.lineCount = 0;
    this.problemLine = 0;
    const id = nextId('code');
    this.gutter = h('div', { class: 'gutter', 'aria-hidden': 'true' });
    this.ta = h('textarea', { id, class: 'code', spellcheck: false, wrap: 'off', autocapitalize: 'off', autocomplete: 'off',
      autocorrect: 'off', 'aria-describedby': `${id}-help ${id}-problem`, 'data-gramm': 'false' });
    this.problem = h('div', { id: `${id}-problem`, class: 'problem', role: 'status', 'aria-live': 'polite', hidden: true });
    this.help = h('p', { id: `${id}-help`, class: 'sr-only', text: 'Tab inserts spaces. Press Escape, then Tab, to move focus out of the editor.' });
    this.el = h('div', { class: 'editor' },
      h('label', { for: id, class: 'sr-only', text: label }),
      h('div', { class: 'editor-scroll' }, this.gutter, this.ta),
      this.problem, this.help);
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

  setDisabled(disabled, placeholder = '') {
    this.ta.disabled = disabled;
    this.ta.placeholder = placeholder;
  }

  focus() { this.ta.focus(); }

  /** problem: null | { kind: 'compile'|'runtime'|'hung'|'probation', message, line? } */
  setProblem(problem) {
    const line = problem ? (problem.line || findLine(problem.message)) : 0;
    if (problem) {
      this.problem.hidden = false;
      this.problem.dataset.kind = problem.kind;
      const label = { compile: 'Compile error', runtime: 'Runtime error', hung: 'Hung', probation: 'Paused' }[problem.kind] || 'Problem';
      const msg = problem.message || '';
      const saysLine = /\bline \d+/i.test(msg);
      this.problem.replaceChildren(
        h('strong', { text: `${label}${line && !saysLine ? ` (line ${line})` : ''}: ` }),
        h('span', { text: msg }));
      if (problem.running) this.problem.append(h('span', { class: 'problem-note', text: ' — the model keeps showing the last version that worked.' }));
    } else {
      this.problem.hidden = true;
      this.problem.replaceChildren();
    }
    if (line !== this.problemLine) {
      this.problemLine = line;
      this._markLine();
    }
  }

  /** Insert text at the cursor (used by the quick reference). */
  insert(text) {
    this.ta.focus();
    insertText(this.ta, text);
  }

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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      this.onSave();
      return;
    }
    if (e.key === 'Escape') { this.escaped = true; return; }
    if (e.key === 'Tab') {
      if (this.escaped || e.ctrlKey || e.altKey || e.metaKey) { this.escaped = false; return; }   // let focus move
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end, value } = ta;
      const multi = value.slice(s, end).includes('\n');
      if (!multi && !e.shiftKey) { insertText(ta, INDENT); return; }
      // indent / outdent every selected line
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const block = value.slice(lineStart, end);
      const lines = block.split('\n');
      const out = lines.map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, '') : INDENT + l)).join('\n');
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
  const m = /\bline (\d+)/i.exec(msg) || /<anonymous>:(\d+):\d+/.exec(msg) || /:(\d+):(\d+)\)?\s*$/.exec(msg);
  return m ? +m[1] : 0;
}
