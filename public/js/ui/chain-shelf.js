// "Add a module": the library's shelves, sources, warps and filters, each by category, plus a blank of each kind.
import { h, humanize, openDialog } from './dom.js';
import { KIND_LABELS } from './model.js';

const KINDS = [
  { kind: 'warp', text: 'Warps move each pixel for the modules after them.' },
  { kind: 'source', text: 'Sources draw. Mark one "input only" to feed a filter without drawing it.' },
  { kind: 'filter', text: 'Filters rework the colour so far, some by another source (their input).' },
];

/** openShelf({ library, onPick(entry | { kind, blank: true }) }) */
export function openShelf({ library, onPick }) {
  return openDialog({ title: 'Add a module', className: 'library-dialog shelf-dialog', build: (close) => {
    const pick = (entry) => { close(); onPick(entry); };
    const item = (title, summary, entry, extra = '') => h('li', {}, h('button', { type: 'button',
      class: `library-item${extra}`, dataset: { kind: entry.kind }, onClick: () => pick(entry) },
    h('span', { class: 'library-title' }, h('span', { class: 'kind-badge', text: KIND_LABELS[entry.kind] }), title),
    summary ? h('span', { class: 'library-summary', text: summary }) : null));
    return KINDS.map(({ kind, text }) => {
      const entries = library.filter((p) => (p.kind || 'source') === kind);
      const cats = [...new Set(entries.map((p) => p.category || 'other'))].sort();
      return h('section', { class: 'shelf', dataset: { kind } },
        h('h3', { class: 'shelf-title', text: `${KIND_LABELS[kind]}s` }), h('p', { class: 'shelf-text', text }),
        cats.map((c) => [h('h4', { class: 'shelf-cat', text: humanize(c) }),
          h('ul', { class: 'library-list' },
            entries.filter((p) => (p.category || 'other') === c).map((p) => item(p.title || p.name, p.summary, p)))]),
        h('ul', { class: 'library-list' }, item(`Blank ${kind}`, 'Write your own.', { kind, blank: true }, ' blank')));
    });
  } });
}
