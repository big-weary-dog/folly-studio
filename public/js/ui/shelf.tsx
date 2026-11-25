// Library pickers (spec/studio "Composition"). Audition and Add share insertion and groups; closing restores
// the look and view and forgets the groups. Tabs are remembered for the session; groups start on the whole rig.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { Module } from '../../../shared/schemas/look.ts';
import type { LibraryEntry } from '../../../shared/schemas/rig.ts';
import { DEFAULT_SOFTEN } from '../../../core/spatial.ts';
import { GroupsTree } from './groups-drawer.tsx';
import { cx, humanize, openDialog } from './kit.tsx';
import type { Extra } from '../runtime.ts';
import { isPreset, moduleFromLibrary, type Layer, withPresetGlobals } from './model.ts';
import type { Preview } from './preview.ts';
import type { Studio } from './studio-store.ts';

type Kind = Module['kind'];
export type Entry = LibraryEntry;
type Audition = { pv: Preview; layer?: Pick<Layer, 'groups'> & Partial<Layer>;
  layers?: (e: Entry) => Layer[] | null; insert?: (mods: Module[], m: Module) => Module[]; replace?: boolean };
type Tab = Kind | 'preset';
type Mode = 'module' | 'layer' | 'look';
const TABS: Record<Mode, [Tab, string, string][]> = {
  module: [['source', 'Sources', 'Draw onto what is above them.'], ['warp', 'Warps', 'Bend everything above them.'],
    ['filter', 'Filters', 'Rework everything above them, some by another source (their input).']],
  layer: [['source', 'Sources', 'Start a layer from one source.'],
    ['preset', 'Presets', 'Layers of modules put together, ready to play.']],
  look: [['preset', 'Presets', 'Looks ready to play: pick one to start from, then make it yours.'],
    ['source', 'Sources', 'Start from one source.']],
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

/** The audition: the look the app sent is kept, and put back unless something was picked. With `replace`, what is
 * auditioned plays in place of the look's layers, not above them. */
export function auditioner({ pv, layer, layers, insert, replace }: Partial<Audition> = {}) {
  let saved: { layers: Layer[]; extra: Extra } | null = null, mine: Layer[] | null = null, timer = 0;
  let shown: Entry | null = null, groups: string[] | undefined;    // a new layer's groups, once picked
  const show = (e: Entry) => {
    const r = pv?.runtime;
    shown = e;
    if (!r?.ready || !layer) return;
    if (!saved || r.layers !== mine) saved = { layers: r.layers, extra: r.extra };   // the look as the app sent it
    const under = replace ? [] : saved.layers;
    let extra = saved.extra;
    if (isPreset(e)) {
      const made = layers?.(e);
      if (!made) return;
      mine = [...under, ...made.map((l, i) => ({ ...l, id: `${TRY}${i}`, ...(groups ? { groups } : {}) }))];
      if (e.globals) extra = { ...extra, globals: withPresetGlobals(extra.globals, e) ?? null };   // as Add gives it
    } else {
      const m = { ...moduleFromLibrary(e), id: TRY };
      mine = m.kind === 'source' && !insert
        ? [...under, { id: TRY, title: m.title, groups: groups ?? layer.groups, blend: 'over', level: 1,
          modules: [m], soften: { ...DEFAULT_SOFTEN } }]                // as a new layer would be
        : saved.layers.map((l) => (l.id !== layer.id ? l : { ...l,
          modules: insert!(l.modules, m) }));
    }
    r.setLook(mine, extra);
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

/** Add a module (`mode: 'module'`), Add a layer (`'layer'`; given `st`, with the new layer's groups, handed to
 * `onPick`) or Start a look (`'look'`: presets first, no groups). */
export function openShelf({ library, onPick, audition, mode, st, sourcesOnly = false }: { library: LibraryEntry[];
  onPick: (e: Entry, groups?: string[]) => void; audition?: Audition; mode: Mode; st?: Studio;
  sourcesOnly?: boolean }) {
  const A = auditioner(audition), tabs = sourcesOnly ? TABS.module.slice(0, 1) : TABS[mode];
  const root = st?.data.index?.root;
  const where = mode === 'layer' && st && root ? st : null;
  let picked = false;
  const title = mode === 'look' ? 'Start a look' : mode === 'layer' ? 'Add a layer'
    : sourcesOnly ? 'Add a source' : 'Add a module';
  if (where) { where.newGroups.value = [root!]; A.regroup([root!]); }
  return openDialog({ title, className: cx('library-dialog shelf-dialog', where && 'has-groups'),
    onClose: () => {
      if (!picked) A.now(null);
      if (where) where.newGroups.value = where.hoverGroup.value = where.pinnedGroup.value = null;
      audition?.pv.viewer?.setClear(null);
    }, body: (close) => {
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
      const shows = (e: Entry) => words.every((w) => [e.title, e.name, e.summary, e.category, ...e.tags].join(' ')
        .toLowerCase().includes(w));
      /** A tab's entries: the library's of its kind, hidden ones left out (kept only for the looks that use them). */
      const entriesOf = (t: Tab): Entry[] => library.filter((e) => e.kind === t && !('hidden' in e && e.hidden));
      const row = (e: Entry) => {
        const text = e.title || e.name, summary = e.summary || '';
        return <li class="shelf-entry" hidden={!shows(e)}>
          <button type="button" class="shelf-row" data-kind={e.kind} data-tour={`shelf:${e.name}`}
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
          <button type="button" class="icon-btn shelf-try" aria-label={`Preview ${text}`}
            onClick={() => trying(e)}>▶</button>
        </li>;
      };
      const list = entriesOf(tab), cats = [...new Set(list.map((e) => e.category || 'other'))];
      const inCat = (c: string) => list.filter((e) => (e.category || 'other') === c);
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
            const n = query ? entriesOf(t).filter(shows).length : 0;
            return <button type="button" role="tab" class="btn small" aria-selected={t === tab} data-kind={t}
              data-tour={`shelf-tab:${t}`}
              onClick={() => { setTab(t); remember(mode, t); }}>{label}{query ? ` ${n}` : ''}</button>;
          })}</div>
          <input type="search" class="shelf-find" placeholder="Filter: fire, rose, chase, sky…"
            aria-label="Filter the library" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        </div>
        <p class="shelf-text">{text}</p>
        <div class="shelves" role="tabpanel">
          {cats.map((c) => <section class="shelf-group" hidden={!inCat(c).some(shows)}>
            <h4 class="shelf-cat">{humanize(c)}</h4><ul class="shelf-list">{inCat(c).map(row)}</ul></section>)}
          <p class="pane-hint" hidden={list.some(shows)}>Nothing here matches. Try another tab.</p>
        </div>
        </div>
        <div class="shelf-bar" ref={bar} hidden={!tried}><span>Previewing <b>{tried?.title}</b>
          {tried && <small class="shelf-said">{tried.summary}</small>}</span>
          {playsOn}
          <button type="button" class="btn small primary" onClick={() => { if (tried) pick(tried); }}>Add</button>
          <button type="button" class="btn small" onClick={() => trying(null)}>Back</button></div>
      </>;
    } });
}
