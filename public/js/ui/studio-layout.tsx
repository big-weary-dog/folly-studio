// The Studio's panes: toolbar, groups, the 3D view, layers and settings, the bottom dock (code, timeline and look
// tabs, a fold toggle, the splitter that sizes it), and the phones' tabs. The timeline and the Look panel sit in the
// dock on a wide screen; phones keep Layers, Look and More. Check & bake opens from Export on laptop.
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { can } from '../../../shared/policy.ts';
import { openBake } from './bake.tsx';
import { ChainPane } from './chain.tsx';
import { deleteLook, mayDelete } from './delete-look.ts';
import { DrawerSlot } from './drawer.tsx';
import { CodeEditor } from './editor.tsx';
import { cx, Field, humanize, lazy, pref, Switch, useLazy } from './kit.tsx';
import { ISSUE_LABELS } from './layer-status.ts';
import { HistoryButton } from './history/button.tsx';
import { LayersPane } from './layers.tsx';
import { loadPalettes } from './model.ts';
import type { Preview } from './preview.ts';
import { PreviewPane } from './preview-view.tsx';
import { RefinePanel } from './refine.tsx';
import { ai, navigate, onPi, user } from './session.ts';
import { onSideHead, SideDivider } from './side-panels.tsx';
import type { Dock, Studio } from './studio-store.ts';
import { Timeline } from './timeline.tsx';
import type { TimelineState } from './timeline-state.ts';
import { TimelineTools } from './timeline-tools.tsx';
import { createPhone, MorePane, openOnTap, phoneAttrs, PhoneTabs, SettingsHead } from './phone/phone.tsx';

type Props = { st: Studio; pv: Preview; tl: TimelineState };
const exporter = lazy(() => import('./export.tsx'));
const lights = lazy(() => import('./play-lights.tsx'));
/** Play on the lights: on the Pi, for those who may queue (SPEC-offline "Playing on the lights"). */
const mayPlay = () => onPi() && can(user.value, 'curate');
const playOnLights = (st: Studio) => lights().then((m) => m.openPlayLights(
  { id: st.lookId.value ?? '', title: st.look.value.title }, !st.lookId.value || st.dirty.value));

/** The panes. It reads only what rarely changes, so an edit redraws the panes that show it, not the Studio. */
export function StudioLayout({ st, pv, tl, els }: Props & { els: Record<string, HTMLElement> }) {
  const narrow = st.narrow.value, root = useRef<HTMLDivElement>(null), side = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false), [ph] = useState(createPhone);
  return (
    <div ref={root} class={cx('studio', st.folded.value && 'code-collapsed', st.dirty.value && 'is-dirty',
      st.baked.value && 'is-baked', resizing && 'resizing')} data-tab={st.tab.value} data-dock={st.dock.value}
      {...phoneAttrs(st, ph)}>
      <Bar st={st} pv={pv} />
      {st.copyOnSave.value && <div class="studio-notice" role="note"><strong>From the gallery</strong>
        {` — “${st.server.value?.title}” by ${st.server.value?.ownerName || 'someone else'}. Play with it freely; `
          + 'Save makes your own copy.'}<AdminDelete st={st} /></div>}
      <PreviewPane st={st} pv={pv} els={els} />
      <Splitter studio={root} setResizing={setResizing} />
      <PhoneTabs st={st} ph={ph} />
      <div class="side" data-pane="layers" data-side={narrow ? undefined : st.side.value} ref={side}
        onClick={narrow ? openOnTap(st, ph) : (e) => onSideHead(st, e)}>
        <LayersPane st={st} pv={pv} />{narrow ? <SettingsHead st={st} ph={ph} /> : <SideDivider side={side} />}
        <ChainPane st={st} pv={pv} /></div>
      {!narrow && <DockPane st={st} pv={pv} tl={tl} />}
      {narrow && <LookTab st={st} />}
      {narrow && <MorePane pv={pv} />}
      <DrawerSlot />
      <div class="sandbox-host" aria-hidden="true" ref={(el) => { if (el) els.sandbox = el; }} />
    </div>);
}

/** An admin's Delete on someone else's gallery look (SPEC-access): back to the gallery once it is gone. */
function AdminDelete({ st }: { st: Studio }) {
  const look = st.server.value, [gone, setGone] = useState('');
  if (!look || gone === look.id || !mayDelete(user.value, look, true)) return null;
  return <button class="btn small ghost danger-text notice-delete" type="button" aria-label={`Delete ${look.title}`}
    onClick={async () => {
      if (!(await deleteLook(look))) return;
      setGone(look.id);
      navigate('/gallery', { force: true });
    }}>Delete</button>;
}

function Share({ st, cls }: { st: Studio; cls: string }) {
  return <Switch label="Share to gallery" class={cls} checked={st.look.value.shared && !st.copyOnSave.value}
    disabled={st.sharing.value} onChange={(on) => st.setShared(on)} />;
}

/** The look's summary, which its gallery card shows: one line under the title, a box in the Look tab. */
function Describe({ st, box }: { st: Studio; box?: boolean }) {
  const set = (e: { currentTarget: { value: string } }) => {
    const summary = e.currentTarget.value;
    st.edit(() => ({ summary }));
  };
  const trim = () => {
    const summary = st.look.peek().summary.trim();
    if (summary !== st.look.peek().summary) st.edit(() => ({ summary }));
  };
  const value = st.look.value.summary || '', placeholder = 'Describe it for the gallery';
  return box ? <Field label="Description" stack hint={<p class="field-hint">Shown on its gallery card.</p>}>
    {(id) => <textarea id={id} rows={3} maxlength={600} placeholder={placeholder} value={value} onInput={set}
      onBlur={trim} />}</Field>
    : <input class="look-summary" type="text" maxlength={600} aria-label="Look description" placeholder={placeholder}
      value={value} onInput={set} onBlur={trim}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />;
}

function Bar({ st, pv }: { st: Studio; pv: Preview }) {
  const L = st.look.value, dirty = st.dirty.value, copy = st.copyOnSave.value;
  const state = st.saving.value ? 'Saving…' : copy ? (dirty ? 'Edited — Save makes your copy' : 'Gallery look')
    : !L.id ? 'Not saved yet' : dirty ? 'Unsaved changes' : 'Saved';
  return (
    <div class="studio-bar">
      <div class="bar-title"><div class="bar-words">
        <input class="look-title" type="text" maxlength={120} aria-label="Look title" placeholder="Untitled look"
          spellcheck={false} value={L.title} onInput={(e) => {
            const title = e.currentTarget.value;
            st.edit(() => ({ title }));
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          onBlur={(e) => { if (!e.currentTarget.value.trim()) st.edit(() => ({ title: 'Untitled look' })); }} />
        <Describe st={st} /></div>
        <span class="save-state" aria-live="polite" data-state={dirty || !L.id ? 'dirty' : 'clean'}>{state}</span>
      </div>
      <div class="bar-actions"><HistoryButton st={st} />
        <Share st={st} cls="share-toggle" /><ExportMenu st={st} pv={pv} />
        <button type="button" class={cx('btn primary save-btn', st.saving.value && 'busy')} title="Save (Ctrl+S)"
          data-tour="save"
          disabled={st.saving.value} onClick={() => st.save()}>Save</button></div>
    </div>);
}

function ExportMenu({ st, pv }: { st: Studio; pv: Preview }) {
  const [open, setOpen] = useState(false), menu = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!open) return undefined;
    (menu.current?.querySelector('button') as HTMLElement | null)?.focus();
    const outside = (e: MouseEvent) => { if (!(e.target as Element).closest('.menu-wrap')) setOpen(false); };
    document.addEventListener('click', outside);
    return () => document.removeEventListener('click', outside);
  }, [open]);
  const item = (text: string, run: () => void, cls?: string) => <button type="button" role="menuitem" class={cls}
    onClick={() => { setOpen(false); run(); }}>{text}</button>;
  const onKey = (e: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll('button') || [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
  };
  return (
    <div class="menu-wrap">
      <button type="button" class="btn" ref={btn} aria-haspopup="true" aria-expanded={open}
        onClick={() => setOpen(!open)}>Export</button>
      <div class="menu" role="menu" ref={menu} hidden={!open} onKeyDown={onKey}>
        {item('Export .fseq…', () => exporter().then((m) => m.exportFseq(st, pv)), 'wide-only')}
        {item('Check & bake…', () => openBake(st, pv))}
        {mayPlay() && item('Play on the lights…', () => playOnLights(st))}
        {item('Export look JSON', () => exporter().then((m) => m.exportJson(st)))}
      </div>
    </div>);
}

const DOCKS: Dock[] = ['code', 'timeline', 'look'];

function DockPane({ st, pv, tl }: Props) {
  const dock = st.dock.value, folded = st.folded.value, narrow = st.narrow.value, ids = [useId(), useId(), useId()];
  return (
    <section class="pane pane-code" data-pane="code" aria-label="Code, timeline and look">
      <div class="pane-head dock-head">
        <div class="dock-tabs" role="group" aria-label="Bottom panel">{DOCKS.map((id) => <button type="button"
          class="dock-tab" data-dock={id} data-tour={`dock:${id}`}
          aria-pressed={dock === id} onClick={() => st.showDock(id)}>
          {humanize(id)}</button>)}</div>
        <span class="pane-sub dock-code-only">{st.codeFor}</span>
        <DockIssue st={st} />
        <div class="dock-tools">{!narrow && <TimelineTools st={st} tl={tl} inspector />}</div>
        <button type="button" class="btn small ghost collapse-btn" aria-expanded={!folded} aria-controls={ids.join(' ')}
          title="Fold the panel away to give the 3D view more room" onClick={() => st.fold(!folded)}>
          {folded ? `Show ${dock}` : 'Hide'}</button>
      </div>
      <div class="pane-body code-body" id={ids[0]}><CodeEditor st={st} /></div>
      <div class="tl-body" id={ids[1]}>{!narrow && <Timeline st={st} pv={pv} tl={tl} />}</div>
      <div class="pane-body look-dock" id={ids[2]}>{!narrow && <><RefinePanel st={st} /><Globals st={st} /></>}</div>
    </section>);
}

/** The code's problem in the dock's head, while the code is folded away or on the timeline. */
function DockIssue({ st }: { st: Studio }) {
  const p = st.problem.value;
  return <span class="dock-issue" data-kind={p?.kind} hidden={!p}>{p && ISSUE_LABELS[p.kind]}</span>;
}

/** The splitter sizes the dock, one height on every tab (a share of the Studio's height, kept per browser), set on
 * the Studio's style directly. */
function Splitter({ studio, setResizing }: { studio: { current: HTMLDivElement | null };
  setResizing: (on: boolean) => void }) {
  const [now, setNow] = useState(() => { const v = Number(pref('studio.split')); return v >= 15 && v <= 75 ? v : 0; });
  const drag = useRef<{ y: number; h: number; total: number } | null>(null);
  const set = (pct: number) => {
    studio.current?.style.setProperty('--code-h', `${pct.toFixed(1)}%`);
    setNow(pct);
    pref('studio.split', pct.toFixed(1));
  };
  useLayoutEffect(() => { if (now) studio.current?.style.setProperty('--code-h', `${now}%`); }, []);
  const end = () => { if (drag.current) { drag.current = null; setResizing(false); } };
  return (
    <div class="splitter" role="separator" aria-orientation="horizontal" tabindex={0}
      aria-label="Resize the bottom panel"
      aria-valuemin={15} aria-valuemax={75} aria-valuenow={now ? Math.round(now) : undefined}
      onPointerDown={(e) => {
        const s = studio.current, pane = s?.querySelector('.pane-code');
        if (!s || !pane) return;
        drag.current = { y: e.clientY, h: pane.getBoundingClientRect().height,
          total: s.getBoundingClientRect().height };
        e.currentTarget.setPointerCapture(e.pointerId);
        setResizing(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) set(Math.min(75, Math.max(15, ((d.h + d.y - e.clientY) / d.total) * 100)));
      }}
      onPointerUp={end} onPointerCancel={end}
      onKeyDown={(e) => {
        const cur = now || 36;
        if (e.key === 'ArrowUp') { e.preventDefault(); set(Math.min(75, cur + 4)); }
        if (e.key === 'ArrowDown') { e.preventDefault(); set(Math.max(15, cur - 4)); }
      }} />);
}

/** The Look panel (the globals) loads when the Look tab of the dock, or a phone's, first shows. */
function Globals({ st }: { st: Studio }) {
  const mod = useLazy(() => Promise.all([import('./look-globals.tsx'), loadPalettes().catch(() => [])]),
    st.ready.value && (st.dock.value === 'look' || st.tab.value === 'look'));
  if (!mod) return null;
  const [{ GlobalsPanel }, palettes] = mod;
  return <GlobalsPanel st={st} palettes={palettes} />;
}

/** Phone Look: palette, existing faders, sharing details and an explicit refinement action. */
function LookTab({ st }: { st: Studio }) {
  const [refining, setRefining] = useState(false);
  return (
    <section class="pane pane-look" data-pane="look" aria-label="Look"><div class="pane-body look-body">
      <div class="globals-slot"><Globals st={st} /></div>
      <Share st={st} cls="share-toggle big" />
      <details class="phone-share-details"><summary>Share details</summary><Describe st={st} box /></details>
      {ai.value && !st.copyOnSave.value && st.server.value && <>
        <button type="button" class="btn" aria-expanded={refining}
          onClick={() => setRefining(!refining)}>Refine with AI</button>
        {refining && <RefinePanel st={st} />}</>}
    </div></section>);
}
