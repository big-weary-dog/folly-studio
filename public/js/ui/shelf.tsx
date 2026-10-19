// The library's shelves: warps, sources and filters by category ("Add a layer" shows only sources), a quick filter,
// and a blank of each kind. Hovering or focusing an entry (on a phone, its Preview button) auditions it in the 3D view
// as a temporary look sent to the sandbox: a source as a top layer on the selected layer's groups, a warp or filter
// in the selected layer's chain where picking puts it. Leaving it, Escape or closing sends back the look exactly as it
// was; picking adds it.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { Module } from '../../../shared/schemas/look.ts';
import type { LibraryEntry } from '../../../shared/schemas/rig.ts';
import { humanize, openDialog } from './kit.tsx';
import { KIND_LABELS, type Layer } from './model.ts';
import type { Preview } from './preview.ts';

type Kind = Module['kind'];
type Entry = LibraryEntry | { kind: Kind; blank: true; name?: undefined; title?: undefined; code?: undefined };
type Audition = { pv: Preview; layer?: Pick<Layer, 'groups'> & Partial<Layer>; moduleId?: string };
const KINDS: [Kind, string][] = [
  ['warp', 'Warps move each pixel for the modules after them.'],
  ['source', 'Sources draw. Mark one "input only" to feed a filter without drawing it.'],
  ['filter', 'Filters rework the colour so far, some by another source (their input).'],
];
const TRY = '~audition';

/** Where picking puts module m in a chain (as chain.tsx's add): after the selected one, a warp before a source. */
function placeIn(mods: Module[], m: Module, selectedId?: string) {
  const i = mods.findIndex((x) => x.id === selectedId);
  return i < 0 ? mods.length : i + (m.kind === 'warp' && mods[i].kind === 'source' ? 0 : 1);
}

/** The audition: the look the app sent is kept, and put back unless something was picked. */
function auditioner({ pv, layer, moduleId }: Partial<Audition> = {}) {
  let saved: { layers: Layer[]; extra: object } | null = null, mine: Layer[] | null = null, timer = 0;
  const show = (e: Entry) => {
    const r = pv?.runtime;
    if (!r?.ready || !layer || 'blank' in e) return;
    if (!saved || r.layers !== mine) saved = { layers: r.layers, extra: r.extra };   // the look as the app sent it
    const m: Module = { id: TRY, kind: e.kind || 'source', title: e.title || e.name, code: e.code, params: {} };
    mine = m.kind === 'source'
      ? [...saved.layers, { id: TRY, title: m.title, groups: layer.groups, blend: 'over', level: 1, modules: [m] }]
      : saved.layers.map((l) => {
        if (l.id !== layer.id) return l;
        const mods = l.modules.slice(), at = placeIn(mods, m, moduleId);
        if (/\bx\s*\[/.test(m.code)) m.input = mods.slice(0, at).reverse().find((x) => x.as === 'input')?.id;
        mods.splice(at, 0, m);
        return { ...l, modules: mods, enabled: true, level: l.level || 1, clips: undefined };
      });
    r.setLook(mine, saved.extra);
    pv?.kick();
  };
  const restore = () => {
    const r = pv?.runtime;
    if (saved && r && r.layers === mine) { r.setLook(saved.layers, saved.extra); pv?.kick(); }
    saved = mine = null;
  };
  const later = (fn: () => void, ms: number) => { clearTimeout(timer); timer = window.setTimeout(fn, ms); };
  return {
    want: (e: Entry | null) => later(() => (e ? show(e) : restore()), e ? 120 : 80), // gliding skips the restore
    now: (e: Entry | null) => { clearTimeout(timer); if (e) show(e); else restore(); },
    drop: () => { clearTimeout(timer); saved = mine = null; },           // picked: the app sends the real look next
  };
}

export function openShelf({ library, onPick, audition, title = 'Add a module', only }: { library: LibraryEntry[];
  onPick: (e: Entry) => void; audition?: Audition; title?: string; only?: Kind }) {
  const A = auditioner(audition);
  let picked = false;
  return openDialog({ title, className: 'library-dialog shelf-dialog', onClose: () => { if (!picked) A.now(null); },
    body: (close) => {
      const [tried, setTried] = useState<Entry | null>(null), [query, setQuery] = useState('');
      const hovered = useRef<Entry | null>(null), bar = useRef<HTMLDivElement>(null);
      useLayoutEffect(() => { bar.current?.closest('dialog')?.classList.toggle('is-trying', !!tried); }, [tried]);
      const pick = (e: Entry) => { picked = true; A.drop(); close(); onPick(e); };
      const want = (e: Entry | null) => { if (!tried) A.want(e); };     // a phone's preview holds until Add or Back
      const trying = (e: Entry | null) => { A.now(e); setTried(e); };
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const shows = (text: string, e: Entry, summary = '') => words.every((w) => [text, summary, e.name, 'blank' in e
        ? '' : e.category, ...('blank' in e ? [] : e.tags || [])].join(' ').toLowerCase().includes(w));
      const item = (text: string, summary: string, e: Entry) => (
        <li class="shelf-entry" hidden={!shows(text, e, summary)}>
          <button type="button" class={'blank' in e ? 'library-item blank' : 'library-item'} data-kind={e.kind}
            onClick={() => pick(e)} onFocus={() => want(e)} onBlur={() => want(null)}
            // only a mouse that moves: a list opening (or hiding) under a resting pointer auditions nothing
            onPointerMove={(ev) => {
              if (ev.pointerType === 'mouse' && (ev.movementX || ev.movementY) && hovered.current !== e) {
                want(hovered.current = e);
              }
            }}
            onPointerLeave={() => { if (hovered.current === e) { hovered.current = null; want(null); } }}>
            <span class="library-title"><span class="kind-badge">{KIND_LABELS[e.kind || 'source']}</span>{text}</span>
            {summary && <span class="library-summary">{summary}</span>}</button>
          {!('blank' in e) && <button type="button" class="btn small shelf-try" aria-label={`Preview ${text}`}
            onClick={() => trying(e)}>Preview</button>}
        </li>);
      const shelf = ([kind, text]: [Kind, string]) => {
        const entries = library.filter((p) => (p.kind || 'source') === kind);
        const cats = [...new Set(entries.map((p) => p.category || 'other'))].map((c) => {
          const list = entries.filter((p) => (p.category || 'other') === c);
          return { c, list, shown: list.some((p) => shows(p.title || p.name, p, p.summary)) };
        });
        const blank = { kind, blank: true } as const, blankShown = shows(`Blank ${kind}`, blank, 'Write your own.');
        return (
          <section class="shelf" data-kind={kind} hidden={!blankShown && !cats.some((x) => x.shown)}>
            {!only && <><h3 class="shelf-title">{KIND_LABELS[kind]}s</h3><p class="shelf-text">{text}</p></>}
            {cats.map(({ c, list, shown }) => <div class="shelf-group" hidden={!shown}>
              <h4 class="shelf-cat">{humanize(c)}</h4>
              <ul class="library-list">{list.map((p) => item(p.title || p.name, p.summary || '', p))}</ul></div>)}
            <ul class="library-list">{item(`Blank ${kind}`, 'Write your own.', blank)}</ul>
          </section>);
      };
      return <>
        <input type="search" class="shelf-find" placeholder="Filter: fire, rose, chase, sky…"
          aria-label="Filter the library" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <div class="shelves">{KINDS.filter(([k]) => !only || k === only).map(shelf)}</div>
        <div class="shelf-bar" ref={bar} hidden={!tried}><span>Previewing <b>{tried?.title}</b></span>
          <button type="button" class="btn small primary" onClick={() => { if (tried) pick(tried); }}>Add</button>
          <button type="button" class="btn small" onClick={() => trying(null)}>Back</button></div>
      </>;
    } });
}
