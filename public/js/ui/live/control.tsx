// /live/control: the phone controller for the live stage (SPEC-live "Pages"). Pick a look, Blackout, a fader for each
// macro the look has, and per layer a level and a mute, all built from the look's data. Changes go over
// the stage's socket; what every viewer shows follows within about 100 ms.
import '../../../css/live.css';

import { useEffect, useRef, useState } from 'preact/hooks';

import type { Listed } from '../../../../shared/schemas/api.ts';
import type { PiQueued } from '../../../../shared/schemas/live.ts';
import { api } from '../../api.ts';
import { cx, humanize, toast } from '../kit.tsx';
import { setTitle } from '../session.ts';
import { Fader } from './fader.tsx';
import { controlsNow } from './lanes.ts';
import { liveSocket, troubleText } from './socket.ts';

const TICK_MS = 250;     // lanes move: the faders follow them this often

export function ControlPage() {
  const ref = useRef<ReturnType<typeof liveSocket> | null>(null);
  const sock = ref.current ??= liveSocket();
  const [looks, setLooks] = useState<Listed[] | null>(null), [pick, setPick] = useState('');
  const [, tick] = useState(0);
  useEffect(() => {
    setTitle('Live control');
    const timer = setInterval(() => tick((n) => n + 1), TICK_MS);
    // This page has no stage of its own, so an update's layers and blackout show at once.
    const unlisten = sock.listen((u) => {
      if (typeof u === 'string' || !sock.live) return;
      if (u.layers) sock.live.layers = u.layers;
      if (u.blackout !== undefined) sock.live.blackout = u.blackout;
    });
    return () => { clearInterval(timer); unlisten(); sock.close(); };
  }, []);
  const control = sock.control.value, error = sock.error.value;
  useEffect(() => {
    if (!control) return;
    api.liveLooks().then((r) => setLooks(r.looks), (err) => toast((err as Error).message, { kind: 'error' }));
  }, [control]);
  useEffect(() => { if (error) { toast(error, { kind: 'warn' }); sock.error.value = ''; } }, [error]);
  void sock.rev.value;
  const live = sock.live, look = live?.look, trouble = troubleText(sock.trouble.value);
  // While /pi drives, the heading names what the lights play (the engine's own look), not the stage's last one.
  const fromPi = live?.driver === 'pi', title = fromPi ? sock.pi.value?.source?.title : look?.title;
  if (!live) {     // no state yet, whether or not the socket opened
    return <section class="live-control"><p role="status">{trouble || 'Connecting to the stage…'}</p></section>;
  }
  if (!control) {
    return (
      <section class="live-control">
        <h1>Live control</h1>
        <p>Only the stage's controllers (curators, unless the host says otherwise) can change what plays.</p>
        <a class="btn" href="/live">Watch the stage</a>
      </section>);
  }
  const set = (values: Record<string, number>) => sock.send({ type: 'set', values });
  return (
    <section class="live-control">
      <div class="lc-head">
        <span class={cx('live-dot', sock.status.value)} title={`Connection: ${sock.status.value}`} />
        <h1>{title ?? 'Nothing playing'}</h1>
        <a class="btn small ghost" href="/live">Watch</a>
      </div>
      {trouble && <p class="lc-trouble" role="status">{trouble}</p>}
      <p class={cx('lc-driver', live?.driver === 'pi' && 'pi')} role="status">
        {live?.driver === 'pi' ? 'Live is driven from /pi. Use a control here to take it back.'
          : 'Live is driven from Live control.'}</p>
      {fromPi && <PiQueue queue={sock.pi.value?.now?.queue ?? []} />}
      <div class="lc-play">
        <select aria-label="Look to play on the stage" value={pick} onChange={(e) => setPick(e.currentTarget.value)}>
          <option value="">{looks ? (looks.length ? 'Pick a look…' : 'No stage looks yet') : 'Loading…'}</option>
          {(looks ?? []).map((l) => <option value={l.id}>{l.title} · {l.ownerName}</option>)}
        </select>
        <button type="button" class="btn primary" disabled={!pick}
          onClick={() => sock.send({ type: 'play', lookId: pick })}>Play</button>
      </div>
      <button type="button" class={cx('pad lc-blackout', live?.blackout && 'on')} aria-pressed={!!live?.blackout}
        onClick={() => sock.send({ type: 'set', blackout: !live?.blackout })}>
        {live?.blackout ? 'Blacked out · Undo' : 'Blackout'}</button>
      {live && look && <>
        <h2>Look</h2>
        {controlsNow(live, sock.now()).map((c) => <Fader key={`${look.id}:${c.name}`}
          label={humanize(c.name)} min={c.min} max={c.max} value={c.value} held={c.held}
          onSet={(v) => set({ [c.name]: v })} onRelease={() => sock.send({ type: 'set', release: [c.name] })} />)}
        <h2>Layers</h2>
        {look.layers.map((l) => {
          const s = live.layers[l.id] ?? {};
          return (
            <div class="lc-layer" key={`${look.id}:${l.id}`}>
              <Fader label={l.title || l.id} min={0} max={1} value={s.level ?? 1}
                onSet={(v) => sock.send({ type: 'set', layers: { [l.id]: { level: v } } })} />
              <button type="button" class={cx('pad lc-mute', s.muted && 'on')} aria-pressed={!!s.muted}
                aria-label={`Mute ${l.title || l.id}`}
                onClick={() => sock.send({ type: 'set', layers: { [l.id]: { muted: !s.muted } } })}>
                {s.muted ? 'Muted' : 'Mute'}</button>
            </div>);
        })}
      </>}
    </section>);
}

/** What the lights play next, as /pi's engine has it (SPEC-offline "Playing on the lights"): read only here. */
function PiQueue({ queue }: { queue: PiQueued[] }) {
  return (
    <div class="lc-queue">
      <h2>Up next on the lights</h2>
      {queue.length ? <ol>{queue.map((q) => <li>{q.title}
        {q.kind === 'baked' && <span class="tag tag-sapphire">Baked</span>}
        {q.by && <span class="lc-by">{q.by}</span>}</li>)}</ol>
        : <p class="pane-hint">Nothing queued: what plays loops on.</p>}
      <a class="btn small" href="/pi/">Open the lights</a>
    </div>);
}
