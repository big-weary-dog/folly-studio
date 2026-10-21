// /live's jukebox on the Pi (SPEC-offline "The live page"): for curators, a switch between the Folly (the stage's 3D
// view, with Skip and Blackout on its bar), the track listing (what plays, the queue, and looks to add from Studio or
// the engine) and the engine's live controls. It talks to the engine over /pi/ws, through Studio's proxy, as the
// engine's own page does, and shares that page's parts (pi/page/controls.tsx, queue.tsx).
import '../../../css/jukebox.css';

import { useEffect, useState } from 'preact/hooks';

import type { Listed } from '../../../../shared/schemas/api.ts';
import { Alerts, Blackout, Controls, Looks, PinScreen } from '../../../../pi/page/controls.tsx';
import { UpNext } from '../../../../pi/page/queue.tsx';
import type { PiSocket } from '../../../../pi/page/socket.ts';
import { api } from '../../api.ts';
import { cx } from '../kit.tsx';

export type View = 'folly' | 'tracks' | 'controls';
type PiState = NonNullable<PiSocket['state']['value']>;
const VIEWS: [View, string][] = [['folly', 'Folly'], ['tracks', 'Tracks'], ['controls', 'Controls']];
const VIEW_KEY = 'studio-live-view', SHOWN = 30;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The view picked, remembered for this browser. */
export function useView(): [View, (v: View) => void] {
  const [view, set] = useState<View>(() => {
    try { return VIEWS.find(([v]) => v === localStorage.getItem(VIEW_KEY))?.[0] ?? 'folly'; } catch { return 'folly'; }
  });
  return [view, (v) => { set(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } }];
}

export function ViewSwitch({ view, set }: { view: View, set: (v: View) => void }) {
  return (
    <div class="seg live-switch" role="group" aria-label="View">
      {VIEWS.map(([v, text]) => <button type="button" class="seg-btn" aria-pressed={view === v}
        onClick={() => set(v)}>{text}</button>)}
    </div>);
}

/** On the Folly's bar: what is left of this look, Skip and Blackout. */
export function JukeboxBar({ sock }: { sock: PiSocket }) {
  const s = sock.state.value;
  if (!s || sock.needPin.value) return null;
  return <>
    {s.look?.left != null && <span class="live-sub jb-left">{clock(s.look.left)} left</span>}
    <button type="button" class="btn small" disabled={!s.queue.length}
      onClick={() => sock.send({ type: 'next' })}>Skip</button>
    <button type="button" class={cx('btn small', s.blackout.on && 'jb-on')} aria-pressed={s.blackout.on}
      onClick={() => sock.send({ type: 'blackout', on: !s.blackout.on })}>
      {s.blackout.on ? 'Blacked out' : 'Blackout'}</button>
  </>;
}

/** The Tracks or the Controls view. */
export function JukeboxPanel({ sock, view }: { sock: PiSocket, view: 'tracks' | 'controls' }) {
  const s = sock.state.value;
  if (sock.needPin.value) return <div class="live-control"><PinScreen sock={sock} title="The lights" /></div>;
  if (!s) return <div class="live-control"><p role="status">Connecting to the lights…</p></div>;
  return (
    <div class={`live-control jukebox jb-${view}`}>
      <NowPlaying s={s} />
      <Alerts s={s} sock={sock} />
      {sock.driver.value === 'live' && <p class="lc-driver pi" role="status">The Folly view shows Live control's
        stage: a control here shows the lights' again.</p>}
      {view === 'tracks' ? <div class="jb-cols">
        <div class="jb-col"><UpNext s={s} sock={sock} /></div>
        <div class="jb-col">
          <h2>Add from Studio</h2>
          <StudioLooks />
          <h2>The lights' own looks</h2>
          <Looks s={s} sock={sock} />
        </div>
      </div> : <>
        <Blackout s={s} sock={sock} />
        <Controls s={s} sock={sock} />
      </>}
    </div>);
}

function NowPlaying({ s }: { s: PiState }) {
  const l = s.look;
  if (!l) return <div class="jb-now"><p class="jb-kicker">On the lights</p><h1>Nothing playing</h1></div>;
  const share = l.left != null && l.duration ? Math.min(1, 1 - l.left / l.duration) : null;
  return (
    <div class="jb-now">
      <p class="jb-kicker">On the lights{l.kind === 'baked' ? ' · baked' : l.kind === 'live' ? ' · from Studio' : ''}
      </p>
      <h1>{l.title}</h1>
      {s.switching && <p class="pi-sub">Switching to {s.switching.title}</p>}
      {share != null
        ? <div class="jb-progress" role="progressbar" aria-label="This look" aria-valuemin={0} aria-valuemax={1}
          aria-valuenow={share}><span style={{ width: `${(share * 100).toFixed(1)}%` }} />
          <span class="jb-progress-text">{clock(l.left!)} left</span></div>
        : <p class="pi-sub">Loops until something is queued</p>}
    </div>);
}

/** Studio's looks (one's own and the gallery's), filtered; each opens Play on the lights, which says how it plays. */
function StudioLooks() {
  const [looks, setLooks] = useState<Listed[] | null>(null), [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    Promise.all([api.looks('mine'), api.looks('gallery')]).then(([mine, gallery]) => {
      const byId = new Map([...mine.looks ?? [], ...gallery.looks ?? []].map((l) => [l.id, l]));
      setLooks([...byId.values()].sort((a, b) => a.title.localeCompare(b.title)));
    }, (e) => setError((e as Error).message));
  }, []);
  const words = q.trim().toLowerCase();
  const found = (looks ?? []).filter((l) => `${l.title} ${l.ownerName}`.toLowerCase().includes(words));
  const play = async (l: Listed) => (await import('../play-lights.tsx')).openPlayLights(l);
  return (
    <div class="jb-studio">
      <input type="search" class="jb-search" placeholder="Find a look" aria-label="Find a look in Studio" value={q}
        onInput={(e) => setQ(e.currentTarget.value)} />
      {error && <p class="pi-error" role="alert">{error}</p>}
      {!looks && !error && <p class="pi-sub">Loading…</p>}
      {looks && !found.length && <p class="pi-sub">No look matches.</p>}
      <ul class="jb-list">
        {found.slice(0, SHOWN).map((l) => <li key={l.id}>
          <button type="button" class="jb-look" onClick={() => void play(l)}>
            <span class="jb-look-title">{l.title}</span><span class="pi-sub">{l.ownerName}</span></button>
        </li>)}
      </ul>
      {found.length > SHOWN && <p class="pi-sub">{found.length - SHOWN} more: narrow the search.</p>}
    </div>);
}
