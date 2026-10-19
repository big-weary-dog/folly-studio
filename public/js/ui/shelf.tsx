// The library's pickers: Add a module (tabs Sources · Warps · Filters) and Add a layer (tabs Blank: a blank layer or
// one source; Presets: layers of modules), each a list of one-line rows by category with a quick filter. The tab is
// remembered for the session. Hovering or focusing a row (on a phone, its ▶) auditions it in the 3D view as a
// temporary look sent to the sandbox: a source or preset as layers on top, a warp or filter in the selected layer's
// chain where picking puts it. Leaving it, Escape or closing sends back the look exactly as it was; picking adds it.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { Module } from '../../../shared/schemas/look.ts';
import type { LibraryEntry } from '../../../shared/schemas/rig.ts';
import { DEFAULT_SOFTEN } from '../core/spatial.ts';
import { cx, humanize, openDialog } from './kit.tsx';
import { insertModule, isPreset, type Layer } from './model.ts';
import type { Preview } from './preview.ts';

type Kind = Module['kind'];
type Blank = { kind: Kind; blank: true; name?: undefined; title?: undefined; code?: undefined; summary?: undefined };
export type Entry = LibraryEntry | Blank;
type Audition = { pv: Preview; layer?: Pick<Layer, 'groups'> & Partial<Layer>; moduleId?: string;
  layers?: (e: Entry) => Layer[] | null };
type Tab = Kind | 'blank' | 'preset';
const TABS: Record<'module' | 'layer', [Tab, string, string][]> = {
  module: [['source', 'Sources', 'Draw onto what is above them.'], ['warp', 'Warps', 'Bend everything above them.'],
    ['filter', 'Filters', 'Rework everything above them, some by another source (their input).']],
  layer: [['blank', 'Blank', 'A layer to write, or one source to start from.'],
    ['preset', 'Presets', 'Layers of modules put together, ready to play.']],
};
const TRY = '~audition';
const remembered = (mode: string): Tab | null => {
  try { return sessionStorage.getItem(`shelf-${mode}`) as Tab | null; } catch { return null; }
};
const remember = (mode: string, tab: Tab) => {
  try { sessionStorage.setItem(`shelf-${mode}`, tab); } catch { /* storage off: the default next time */ }
};

/** The audition: the look the app sent is kept, and put back unless something was picked. */
function auditioner({ pv, layer, moduleId, layers }: Partial<Audition> = {}) {
  let saved: { layers: Layer[]; extra: object } | null = null, mine: Layer[] | null = null, timer = 0;
  const show = (e: Entry) => {
    const r = pv?.runtime;
    if (!r?.ready || !layer || 'blank' in e) return;
    if (!saved || r.layers !== mine) saved = { layers: r.layers, extra: r.extra };   // the look as the app sent it
    if (isPreset(e)) {
      const made = layers?.(e);
      if (!made) return;
      mine = [...saved.layers, ...made.map((l, i) => ({ ...l, id: `${TRY}${i}` }))];
    } else {
      const m: Module = { id: TRY, kind: e.kind || 'source', title: e.title || e.name, code: e.code, params: {} };
      mine = m.kind === 'source'
        ? [...saved.layers, { id: TRY, title: m.title, groups: layer.groups, blend: 'over', level: 1, modules: [m],
          soften: { ...DEFAULT_SOFTEN } }]                              // as a new layer would be
        : saved.layers.map((l) => (l.id !== layer.id ? l : { ...l, modules: insertModule(l.modules, m, moduleId),
          enabled: true, level: l.level || 1, clips: undefined }));
    }
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

/** Add a module (`mode: 'module'`) or Add a layer (`'layer'`). */
export function openShelf({ library, onPick, audition, mode }: { library: LibraryEntry[];
  onPick: (e: Entry) => void; audition?: Audition; mode: 'module' | 'layer' }) {
  const A = auditioner(audition), tabs = TABS[mode];
  let picked = false;
  const title = mode === 'layer' ? 'Add a layer' : 'Add a module';
  return openDialog({ title, className: 'library-dialog shelf-dialog',
    onClose: () => { if (!picked) A.now(null); }, body: (close) => {
      const [tried, setTried] = useState<Entry | null>(null), [query, setQuery] = useState('');
      const [tab, setTab] = useState<Tab>(() => tabs.find(([t]) => t === remembered(mode))?.[0] ?? tabs[0][0]);
      const hovered = useRef<Entry | null>(null), bar = useRef<HTMLDivElement>(null);
      useLayoutEffect(() => { bar.current?.closest('dialog')?.classList.toggle('is-trying', !!tried); }, [tried]);
      const pick = (e: Entry) => { picked = true; A.drop(); close(); onPick(e); };
      const want = (e: Entry | null) => { if (!tried) A.want(e); };     // a phone's preview holds until Add or Back
      const trying = (e: Entry | null) => { A.now(e); setTried(e); };
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const shows = (e: Entry) => words.every((w) => ('blank' in e ? `blank ${e.kind}` : [e.title, e.name, e.summary,
        e.category, ...e.tags].join(' ')).toLowerCase().includes(w));
      /** A tab's entries: by kind; Blank is a blank layer and the sources. */
      const entriesOf = (t: Tab): Entry[] => (t === 'blank' ? [{ kind: 'source', blank: true } as Blank,
        ...library.filter((e) => e.kind === 'source')] : [...library.filter((e) => e.kind === t),
        ...(t === 'preset' ? [] : [{ kind: t, blank: true } as Blank])]);
      const row = (e: Entry) => {
        const text = 'blank' in e ? (mode === 'layer' ? 'Blank layer' : `Blank ${e.kind}`) : e.title || e.name;
        const summary = 'blank' in e ? 'Write your own.' : e.summary || '';
        return <li class="shelf-entry" hidden={!shows(e)}>
          <button type="button" class={cx('shelf-row', 'blank' in e && 'blank')} data-kind={e.kind}
            title={summary} onClick={() => pick(e)} onFocus={() => want(e)} onBlur={() => want(null)}
            // only a mouse that moves: a list opening (or hiding) under a resting pointer auditions nothing
            onPointerMove={(ev) => {
              if (ev.pointerType === 'mouse' && (ev.movementX || ev.movementY) && hovered.current !== e) {
                want(hovered.current = e);
              }
            }}
            onPointerLeave={() => { if (hovered.current === e) { hovered.current = null; want(null); } }}>
            <i class="kind-dot" aria-hidden="true" /><span class="shelf-name">{text}</span>
            <span class="shelf-sum">{summary}</span></button>
          {!('blank' in e) && <button type="button" class="icon-btn shelf-try" aria-label={`Preview ${text}`}
            onClick={() => trying(e)}>▶</button>}
        </li>;
      };
      const list = entriesOf(tab), blanks = list.filter((e) => 'blank' in e);
      const cats = [...new Set(list.filter((e) => !('blank' in e)).map((e) => (e as LibraryEntry).category
        || 'other'))];
      const inCat = (c: string) => list.filter((e) => !('blank' in e) && ((e as LibraryEntry).category || 'other')
        === c);
      const text = tabs.find(([t]) => t === tab)![2];
      return <>
        <div class="shelf-head">
          <div class="shelf-tabs" role="tablist" aria-label="Kind">{tabs.map(([t, label]) => {
            const n = query ? entriesOf(t).filter((e) => !('blank' in e) && shows(e)).length : 0;
            return <button type="button" role="tab" class="btn small" aria-selected={t === tab} data-kind={t}
              onClick={() => { setTab(t); remember(mode, t); }}>{label}{query ? ` ${n}` : ''}</button>;
          })}</div>
          <input type="search" class="shelf-find" placeholder="Filter: fire, rose, chase, sky…"
            aria-label="Filter the library" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        </div>
        <p class="shelf-text">{text}</p>
        <div class="shelves" role="tabpanel">
          {mode === 'layer' && blanks.length > 0 && <ul class="shelf-list">{blanks.map(row)}</ul>}
          {cats.map((c) => <section class="shelf-group" hidden={!inCat(c).some(shows)}>
            <h4 class="shelf-cat">{humanize(c)}</h4><ul class="shelf-list">{inCat(c).map(row)}</ul></section>)}
          {mode === 'module' && <ul class="shelf-list">{blanks.map(row)}</ul>}
          <p class="pane-hint" hidden={list.some(shows)}>Nothing here matches. Try another tab.</p>
        </div>
        <div class="shelf-bar" ref={bar} hidden={!tried}><span>Previewing <b>{tried?.title}</b>
          {tried && !('blank' in tried) && <small class="shelf-said">{tried.summary}</small>}</span>
          <button type="button" class="btn small primary" onClick={() => { if (tried) pick(tried); }}>Add</button>
          <button type="button" class="btn small" onClick={() => trying(null)}>Back</button></div>
      </>;
    } });
}

