// The library's shelves: warps, sources and filters by category ("Add a layer" shows only sources), a quick
// filter, and a blank of each kind. Hovering or focusing an entry (on a phone, its Preview button) auditions it in
// the 3D view as a temporary look sent to the sandbox: a source as a top layer on the selected layer's groups, a
// warp or filter in the selected layer's chain where picking puts it. Leaving it, Escape or closing sends back the
// look exactly as it was; picking adds it.
import { h, humanize, openDialog } from './dom.js';
import { KIND_LABELS } from './model.js';

const KINDS = [
  { kind: 'warp', text: 'Warps move each pixel for the modules after them.' },
  { kind: 'source', text: 'Sources draw. Mark one "input only" to feed a filter without drawing it.' },
  { kind: 'filter', text: 'Filters rework the colour so far, some by another source (their input).' },
];
const TRY = '~audition';

/** Where picking puts module m in a chain (as chain.js's add): after the selected one, a warp before a source. */
function placeIn(mods, m, selectedId) {
  const i = mods.findIndex((x) => x.id === selectedId);
  return i < 0 ? mods.length : i + (m.kind === 'warp' && mods[i].kind === 'source' ? 0 : 1);
}

/** The audition. { preview, layer, moduleId }: the Studio's preview (its runtime and kick) and the selection. */
function auditioner({ preview, layer, moduleId } = {}) {
  let saved = null, mine = null, timer = 0;
  const show = (e) => {
    const r = preview?.runtime;
    if (!r?.ready || !layer || e.blank) return;
    if (!saved || r.layers !== mine) saved = { layers: r.layers, extra: r.extra };   // the look as the app sent it
    const m = { id: TRY, kind: e.kind, title: e.title, code: e.code, params: {} };
    mine = e.kind === 'source'
      ? [...saved.layers, { id: TRY, title: e.title, groups: layer.groups, blend: 'over', level: 1, modules: [m] }]
      : saved.layers.map((l) => {
        if (l.id !== layer.id) return l;
        const mods = l.modules.slice(), at = placeIn(mods, m, moduleId);
        if (/\bx\s*\[/.test(m.code)) m.input = mods.slice(0, at).reverse().find((x) => x.as === 'input')?.id;
        mods.splice(at, 0, m);
        return { ...l, modules: mods, enabled: true, level: l.level || 1, clips: undefined };
      });
    r.setLook(mine, saved.extra);
    preview.kick();
  };
  const restore = () => {
    const r = preview?.runtime;
    if (saved && r && r.layers === mine) { r.setLook(saved.layers, saved.extra); preview.kick(); }
    saved = mine = null;
  };
  const later = (fn, ms) => { clearTimeout(timer); timer = setTimeout(fn, ms); };
  return {
    want: (e) => later(() => (e ? show(e) : restore()), e ? 120 : 80),   // gliding between entries skips the restore
    now: (e) => { clearTimeout(timer); if (e) show(e); else restore(); },
    drop: () => { clearTimeout(timer); saved = mine = null; },           // picked: the app sends the real look next
  };
}

/** openShelf({ library, onPick(entry | { kind, blank: true }), audition?, title?, only?: one kind }) */
export function openShelf({ library, onPick, audition, title = 'Add a module', only }) {
  const A = auditioner(audition);
  let picked = false;
  return openDialog({ title, className: 'library-dialog shelf-dialog',
    onClose: () => { if (!picked) A.now(null); }, build: (close) => {
      const pick = (e) => { picked = true; A.drop(); close(); onPick(e); };
      const rows = [], name = h('b');
      let tried = null, hovered = null;
      const bar = h('div', { class: 'shelf-bar', hidden: true }, h('span', {}, 'Previewing ', name),
        h('button', { type: 'button', class: 'btn small primary', text: 'Add', onClick: () => pick(tried) }),
        h('button', { type: 'button', class: 'btn small', text: 'Back', onClick: () => trying(null) }));
      const want = (e) => { if (!tried) A.want(e); };     // a phone's preview holds until Add or Back
      const trying = (e) => {
        A.now(e);
        tried = e;
        name.textContent = e ? e.title : '';
        bar.hidden = !e;
        bar.closest('dialog').classList.toggle('is-trying', !!e);
      };
      const item = (text, summary, e, extra = '') => {
        const li = h('li', { class: 'shelf-entry' }, h('button', { type: 'button', class: `library-item${extra}`,
          dataset: { kind: e.kind }, onClick: () => pick(e), onFocus: () => want(e), onBlur: () => want(null),
          // only a mouse that moves: a list opening (or hiding) under a resting pointer auditions nothing
          onPointermove: (ev) => {
            if (ev.pointerType === 'mouse' && (ev.movementX || ev.movementY) && hovered !== e) want(hovered = e);
          },
          onPointerleave: () => { if (hovered === e) { hovered = null; want(null); } } },
        h('span', { class: 'library-title' }, h('span', { class: 'kind-badge', text: KIND_LABELS[e.kind] }), text),
        summary ? h('span', { class: 'library-summary', text: summary }) : null),
        e.blank ? null : h('button', { type: 'button', class: 'btn small shelf-try', text: 'Preview',
          'aria-label': `Preview ${text}`, onClick: () => trying(e) }));
        rows.push([li, [text, summary, e.name, e.category, ...(e.tags || [])].join(' ').toLowerCase()]);
        return li;
      };
      const shelf = ({ kind, text }) => {
        const entries = library.filter((p) => (p.kind || 'source') === kind);
        const group = (c) => h('div', { class: 'shelf-group' }, h('h4', { class: 'shelf-cat', text: humanize(c) }),
          h('ul', { class: 'library-list' }, entries.filter((p) => (p.category || 'other') === c)
            .map((p) => item(p.title || p.name, p.summary, p))));
        const head = only ? null : [h('h3', { class: 'shelf-title', text: `${KIND_LABELS[kind]}s` }),
          h('p', { class: 'shelf-text', text })];
        const cats = [...new Set(entries.map((p) => p.category || 'other'))];
        const blank = item(`Blank ${kind}`, 'Write your own.', { kind, blank: true }, ' blank');
        return h('section', { class: 'shelf', dataset: { kind } }, head, cats.map(group),
          h('ul', { class: 'library-list' }, blank));
      };
      const shelves = h('div', { class: 'shelves' }, KINDS.filter((k) => !only || k.kind === only).map(shelf));
      const find = h('input', { type: 'search', class: 'shelf-find', placeholder: 'Filter: fire, rose, chase, sky…',
        'aria-label': 'Filter the library', onInput: () => {
          const words = find.value.toLowerCase().split(/\s+/).filter(Boolean);
          for (const [li, text] of rows) li.hidden = !words.every((w) => text.includes(w));
          for (const box of shelves.querySelectorAll('.shelf, .shelf-group')) {
            box.hidden = !box.querySelector('li:not([hidden])');
          }
        } });
      return [find, shelves, bar];
    } });
}
