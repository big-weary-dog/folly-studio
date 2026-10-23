// The library's pickers: Add a module (tabs Sources · Warps · Filters) and Add a layer (tabs Sources: a blank layer or
// one source; Presets: layers of modules), with categories, a filter and the tab remembered for the session.
// Hover/focus (a phone's ▶) auditions with the same insertion as Add. Leaving or closing restores the look.
// Add a layer picks its groups beside the list (on a phone behind Plays on), starting on the whole rig.
// Audition and Add share those groups; closing forgets them.
// The view frames the rig in the space the shelf leaves clear; closing puts the view back.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { Module } from '../../../shared/schemas/look.ts';
import type { LibraryEntry } from '../../../shared/schemas/rig.ts';
import { DEFAULT_SOFTEN } from '../core/spatial.ts';
import { GroupsTree } from './groups-drawer.tsx';
import { useCustomCode } from './custom-code.ts';
import { cx, humanize, openDialog } from './kit.tsx';
import { isPreset, moduleFromLibrary, type Layer } from './model.ts';
import type { Preview } from './preview.ts';
import type { Studio } from './studio-store.ts';

type Kind = Module['kind'];
type Blank = { kind: Kind; blank: true; name?: undefined; title?: undefined; code?: undefined; summary?: undefined };
export type Entry = LibraryEntry | Blank;
type Audition = { pv: Preview; layer?: Pick<Layer, 'groups'> & Partial<Layer>;
  layers?: (e: Entry) => Layer[] | null; insert?: (mods: Module[], m: Module) => Module[] };
type Tab = Kind | 'blank' | 'preset';
const TABS: Record<'module' | 'layer', [Tab, string, string][]> = {
  module: [['source', 'Sources', 'Draw onto what is above them.'], ['warp', 'Warps', 'Bend everything above them.'],
    ['filter', 'Filters', 'Rework everything above them, some by another source (their input).']],
  layer: [['blank', 'Sources', 'Start a layer from one source.'],
    ['preset', 'Presets', 'Layers of modules put together, ready to play.']],
};
const TRY = '~audition';
const remembered = (mode: string): Tab | null => {
  try { return sessionStorage.getItem(`shelf-${mode}`) as Tab | null; } catch { return null; }
};
const remember = (mode: string, tab: Tab) => {
  try { sessionStorage.setItem(`shelf-${mode}`, tab); } catch { /* storage off: the default next time */ }
};

/** The biggest part of the canvas the dialog leaves clear, in CSS px of the canvas; null when it is too small. */
function clearOf(canvas: HTMLElement, dlg: HTMLElement) {
  const c = canvas.getBoundingClientRect(), d = dlg.getBoundingClientRect(), W = c.width, H = c.height;
  const at = (v: number, max: number) => Math.round(Math.min(max, Math.max(0, v)));
  const l = at(d.left - c.left, W), r = at(d.right - c.left, W), t = at(d.top - c.top, H), b = at(d.bottom - c.top, H);
  const parts = r > l && b > t ? [{ x: 0, y: 0, w: l, h: H }, { x: r, y: 0, w: W - r, h: H },
    { x: 0, y: 0, w: W, h: t }, { x: 0, y: b, w: W, h: H - b }] : [{ x: 0, y: 0, w: W, h: H }];
  const best = parts.reduce((a, p) => (p.w * p.h > a.w * a.h ? p : a));
  return best.w >= 120 && best.h >= 120 ? { ...best, w: Math.round(best.w), h: Math.round(best.h) } : null;
}

/** The audition: the look the app sent is kept, and put back unless something was picked. */
export function auditioner({ pv, layer, layers, insert }: Partial<Audition> = {}) {
  let saved: { layers: Layer[]; extra: object } | null = null, mine: Layer[] | null = null, timer = 0;
  let shown: Entry | null = null, groups: string[] | undefined;    // a new layer's groups, once picked
  const show = (e: Entry) => {
    const r = pv?.runtime;
    shown = e;
    if (!r?.ready || !layer || 'blank' in e) return;
    if (!saved || r.layers !== mine) saved = { layers: r.layers, extra: r.extra };   // the look as the app sent it
    if (isPreset(e)) {
      const made = layers?.(e);
      if (!made) return;
      mine = [...saved.layers, ...made.map((l, i) => ({ ...l, id: `${TRY}${i}`, ...(groups ? { groups } : {}) }))];
    } else {
      const m = { ...moduleFromLibrary(e), id: TRY };
      mine = m.kind === 'source' && !insert
        ? [...saved.layers, { id: TRY, title: m.title, groups: groups ?? layer.groups, blend: 'over', level: 1,
          modules: [m], soften: { ...DEFAULT_SOFTEN } }]                // as a new layer would be
        : saved.layers.map((l) => (l.id !== layer.id ? l : { ...l,
          modules: insert!(l.modules, m) }));
    }
    r.setLook(mine, saved.extra);
    pv?.kick();
  };
  const restore = () => {
    const r = pv?.runtime;
    if (saved && r && r.layers === mine) { r.setLook(saved.layers, saved.extra); pv?.kick(); }
    saved = mine = shown = null;
  };
  const later = (fn: () => void, ms: number) => { clearTimeout(timer); timer = window.setTimeout(fn, ms); };
  return {
    want: (e: Entry | null) => later(() => (e ? show(e) : restore()), e ? 120 : 80), // gliding skips the restore
    now: (e: Entry | null) => { clearTimeout(timer); if (e) show(e); else restore(); },
    drop: () => { clearTimeout(timer); saved = mine = shown = null; },   // picked: the app sends the real look next
    hold: () => clearTimeout(timer),                                     // into the groups: what is auditioned stays
    /** The new layer's groups changed: what is auditioned plays on them. */
    regroup: (g: string[]) => { groups = g; if (shown && mine && pv?.runtime?.layers === mine) show(shown); },
  };
}

/** Add a module (`mode: 'module'`) or Add a layer (`'layer'`; given `st`, with the new layer's groups, handed to
 * `onPick`). */
export function openShelf({ library, onPick, audition, mode, st, sourcesOnly = false }: { library: LibraryEntry[];
  onPick: (e: Entry, groups?: string[]) => void; audition?: Audition; mode: 'module' | 'layer'; st?: Studio;
  sourcesOnly?: boolean }) {
  const A = auditioner(audition), tabs = sourcesOnly ? TABS.module.slice(0, 1) : TABS[mode];
  const root = st?.data.index?.root;
  const where = mode === 'layer' && st && root ? st : null;
  let picked = false;
  const title = mode === 'layer' ? 'Add a layer' : sourcesOnly ? 'Add a source' : 'Add a module';
  if (where) { where.newGroups.value = [root!]; A.regroup([root!]); }
  return openDialog({ title, className: cx('library-dialog shelf-dialog', where && 'has-groups'),
    onClose: () => {
      if (!picked) A.now(null);
      if (where) where.newGroups.value = where.hoverGroup.value = where.pinnedGroup.value = null;
      audition?.pv.viewer?.setClear(null);
    }, body: (close) => {
      const customCode = useCustomCode();
      const [tried, setTried] = useState<Entry | null>(null), [query, setQuery] = useState('');
      const [groups, setGroups] = useState(() => [root!]), [placing, setPlacing] = useState(false);
      const [tab, setTab] = useState<Tab>(() => tabs.find(([t]) => t === remembered(mode))?.[0] ?? tabs[0][0]);
      const hovered = useRef<Entry | null>(null), bar = useRef<HTMLDivElement>(null);
      const reframe = useRef<(animate: boolean) => void>(() => {});
      useLayoutEffect(() => {
        const v = audition?.pv.viewer, d = bar.current?.closest('dialog');
        if (!v || !d) return;
        let last = '';
        reframe.current = (animate) => {
          const r = clearOf(v.canvas, d), key = JSON.stringify(r);
          if (key !== last) { last = key; v.setClear(r, { animate }); }
        };
        const ro = new ResizeObserver(() => reframe.current(false));     // a resize keeps the framing, at once
        ro.observe(d); ro.observe(v.canvas);
        return () => ro.disconnect();
      }, []);
      useLayoutEffect(() => {
        const d = bar.current?.closest('dialog');
        d?.classList.toggle('is-trying', !!tried);
        d?.classList.toggle('is-placing', placing);
        reframe.current(true);
      }, [tried, placing]);
      const pick = (e: Entry) => { picked = true; A.drop(); close(); onPick(e, where ? groups : undefined); };
      const regroup = (g: string[]) => { setGroups(g); A.regroup(g); if (where) where.newGroups.value = g; };
      const want = (e: Entry | null) => { if (!tried) A.want(e); };     // a phone's preview holds until Add or Back
      const trying = (e: Entry | null) => { A.now(e); setTried(e); };
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const shows = (e: Entry) => words.every((w) => ('blank' in e ? `blank ${e.kind}` : [e.title, e.name, e.summary,
        e.category, ...e.tags].join(' ')).toLowerCase().includes(w));
      /** A tab's entries: by kind; Blank is a blank layer and the sources. */
      const entriesOf = (t: Tab): Entry[] => (t === 'blank' ? [{ kind: 'source', blank: true } as Blank,
        ...library.filter((e) => e.kind === 'source')] : [...library.filter((e) => e.kind === t),
        ...(t === 'preset' ? [] : [{ kind: t, blank: true } as Blank])]).filter((e) => customCode || !('blank' in e));
      const row = (e: Entry) => {
        const text = 'blank' in e ? (mode === 'layer' ? 'Blank layer' : `Blank ${e.kind}`) : e.title || e.name;
        const summary = 'blank' in e ? 'Write your own.' : e.summary || '';
        return <li class="shelf-entry" hidden={!shows(e)}>
          <button type="button" class={cx('shelf-row', 'blank' in e && 'blank')} data-kind={e.kind}
            data-tour={`shelf:${'blank' in e ? `blank-${e.kind}` : e.name}`}
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
      const playsOn = where && <button type="button" class="btn small shelf-where" onClick={() => setPlacing(true)}
        title="Choose the groups the new layer plays on">Plays on: {where.groupNames(groups)}</button>;
      return <>
        {where && <section class="shelf-groups" aria-label="Plays on" onPointerEnter={A.hold} onFocusIn={A.hold}>
          <div class="drawer-head"><h3 class="drawer-title">Groups · new layer</h3>
            <button type="button" class="btn small shelf-back" onClick={() => setPlacing(false)}>Done</button></div>
          <div class="tree-wrap"><GroupsTree st={where} groups={groups} set={regroup} /></div></section>}
        <div class="shelf-main">
        {playsOn}
        <div class="shelf-head">
          <div class="shelf-tabs" role="tablist" aria-label="Kind">{tabs.map(([t, label]) => {
            const n = query ? entriesOf(t).filter((e) => !('blank' in e) && shows(e)).length : 0;
            return <button type="button" role="tab" class="btn small" aria-selected={t === tab} data-kind={t}
              data-tour={`shelf-tab:${t}`}
              onClick={() => { setTab(t); remember(mode, t); }}>{label}{query ? ` ${n}` : ''}</button>;
          })}</div>
          <input type="search" class="shelf-find" placeholder="Filter: fire, rose, chase, sky…"
            aria-label="Filter the library" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        </div>
        <p class="shelf-text">{text}</p>
        {customCode === false && <p class="pane-hint">An admin turned custom code off.
          Choose a library module or preset.</p>}
        <div class="shelves" role="tabpanel">
          {mode === 'layer' && blanks.length > 0 && <ul class="shelf-list">{blanks.map(row)}</ul>}
          {cats.map((c) => <section class="shelf-group" hidden={!inCat(c).some(shows)}>
            <h4 class="shelf-cat">{humanize(c)}</h4><ul class="shelf-list">{inCat(c).map(row)}</ul></section>)}
          {mode === 'module' && <ul class="shelf-list">{blanks.map(row)}</ul>}
          <p class="pane-hint" hidden={list.some(shows)}>Nothing here matches. Try another tab.</p>
        </div>
        </div>
        <div class="shelf-bar" ref={bar} hidden={!tried}><span>Previewing <b>{tried?.title}</b>
          {tried && !('blank' in tried) && <small class="shelf-said">{tried.summary}</small>}</span>
          {playsOn}
          <button type="button" class="btn small primary" onClick={() => { if (tried) pick(tried); }}>Add</button>
          <button type="button" class="btn small" onClick={() => trying(null)}>Back</button></div>
      </>;
    } });
}
