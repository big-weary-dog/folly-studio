// The engine's live controls and its looks, shared by its control page (app.tsx) and Studio's /live jukebox
// (public/js/ui/live/jukebox.tsx): Blackout, the master, the tap pad with the beat (a nudge either side), the playing
// look's own controls (built from its globals.live), every look to play or queue, the PIN screen and the alerts.
import { useEffect, useState } from 'preact/hooks';

import { Fader } from '../../public/js/ui/live/fader.tsx';
import { cx } from '../../public/js/ui/kit.tsx';
import type { Control, PiState } from '../src/protocol.ts';
import type { PiSocket } from './socket.ts';

const LABELS: Record<string, string> = { level: 'Look level' };
const label = (name: string) => LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ');

/** The beat now, between states: lit through the first quarter of each beat. */
function useBeat(sock: PiSocket) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const s = sock.state.value?.look;
      const beats = s ? s.beats + (performance.now() - sock.at.value) / 1000 * s.bpm / 60 : 0;
      setOn(!!s && beats - Math.floor(beats) < 0.25);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return on;
}

export function PinScreen({ sock, title = 'Studio Live' }: { sock: PiSocket, title?: string }) {
  const [pin, setPin] = useState('');
  return (
    <form class="pi-pin" onSubmit={(e) => { e.preventDefault(); sock.unlock(pin); setPin(''); }}>
      <h1>{title}</h1>
      <p>This Pi asks for a PIN before the page can change the lights.</p>
      <input type="password" inputMode="numeric" autoComplete="off" aria-label="PIN" value={pin}
        onInput={(e) => setPin(e.currentTarget.value)} />
      {sock.error.value && <p class="pi-error" role="alert">{sock.error.value}</p>}
      <button type="submit" class="pad" disabled={!pin}>Unlock</button>
    </form>);
}

/** A flash-guard trip and the socket's last error, said at the top. */
export function Alerts({ s, sock }: { s: PiState, sock: PiSocket }) {
  return <>
    {s.tripped && <p class="pi-banner trip" role="alert">The flash guard caught {s.looks.find((l) => l.id
      === s.tripped!.look)?.title ?? s.tripped.look} flashing, so the safe look is playing. Pick a look to go on.</p>}
    {sock.error.value && <p class="pi-error" role="alert" onClick={() => { sock.error.value = ''; }}>
      {sock.error.value}</p>}
  </>;
}

export function Blackout({ s, sock }: { s: PiState, sock: PiSocket }) {
  const on = s.blackout.on;
  return <button type="button" class={cx('pad lc-blackout', on && 'on')} aria-pressed={on}
    onClick={() => sock.send({ type: 'blackout', on: !on })}>
    {on ? 'Blacked out · Undo' : 'Blackout'}</button>;
}

/** The master, tap tempo and the look's own controls; Blackout is the caller's, placed where it fits. */
export function Controls({ s, sock }: { s: PiState, sock: PiSocket }) {
  const beat = useBeat(sock), look = s.look;
  const set = (c: Control) => (v: number) => sock.send({ type: 'set', name: c.name, value: v });
  // The tempo is tap tempo's, with a nudge either side when the look offers bpm, so not a fader as well.
  const bpm = look?.controls.find((c) => c.kind === 'bpm');
  type Num = Extract<Control, { kind: 'macro' | 'bpm' }>;
  const controls = look?.controls.filter((c): c is Num => c.kind === 'macro') ?? [];
  const nudge = (d: number) => () => bpm && sock.send({ type: 'set', name: 'bpm',
    value: Math.min(bpm.max, Math.max(bpm.min, look!.bpm + d)) });
  return <>
    <Fader label="Master" min={0} max={1} value={s.level} onSet={(v) => sock.send({ type: 'level', value: v })} />
    <div class="pi-tempo">
      {bpm && <button type="button" class="pad pi-nudge" aria-label="Slower by 1 BPM" onClick={nudge(-1)}>−</button>}
      <button type="button" class="pad pi-tap" onPointerDown={(e) => {
        e.preventDefault();
        sock.send({ type: 'tap', at: performance.now() });
      }} onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') sock.send({ type: 'tap', at: performance.now() });
      }}>
        <span class={cx('pi-beat', beat && 'on')} />Tap tempo<span class="pi-bpm">{look?.bpm.toFixed(1)} BPM</span>
      </button>
      {bpm && <button type="button" class="pad pi-nudge" aria-label="Faster by 1 BPM" onClick={nudge(1)}>+</button>}
    </div>
    {look && controls.length > 0 && <>
      <h2>This look</h2>
      {controls.map((c) => <Fader key={`${look.id}:${c.name}`} label={label(c.name)} min={c.min} max={c.max}
        value={c.value} onSet={set(c)} />)}
    </>}
  </>;
}

/** The engine's own looks: tap to play, + to queue. */
export function Looks({ s, sock }: { s: PiState, sock: PiSocket }) {
  return (
    <div class="pi-looks">
      {s.looks.map((l) => <div key={l.id} class="pi-look-row">
        <button type="button" disabled={!l.playable} title={l.error}
          class={cx('pad pi-look', l.id === s.look?.id && 'current')} aria-pressed={l.id === s.look?.id}
          onClick={() => sock.send({ type: 'play', id: l.id })}>{l.title}</button>
        <button type="button" class="pad pi-mini" disabled={!l.playable} aria-label={`Queue ${l.title}`}
          title="Add to the queue" onClick={() => sock.send({ type: 'queue', id: l.id })}>+</button>
      </div>)}
    </div>);
}
