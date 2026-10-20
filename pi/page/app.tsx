// The Pi's control page: one column of big targets for a phone in the dark. Blackout first, then the master, the tap
// pad with the beat (a nudge either side), the playing look's own controls (built from its globals.live), every look
// to switch to, and what the Pi is sending. A flash-guard trip and a dry run each say so at the top.
import { useEffect, useRef, useState } from 'preact/hooks';

import { Fader } from '../../public/js/ui/live/fader.tsx';
import { cx } from '../../public/js/ui/kit.tsx';
import type { Control, PiState } from '../src/protocol.ts';
import { piSocket, type PiSocket } from './socket.ts';

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

function PinScreen({ sock }: { sock: PiSocket }) {
  const [pin, setPin] = useState('');
  return (
    <form class="pi-pin" onSubmit={(e) => { e.preventDefault(); sock.unlock(pin); setPin(''); }}>
      <h1>Studio Live</h1>
      <p>This Pi asks for a PIN before the page can change the lights.</p>
      <input type="password" inputMode="numeric" autoComplete="off" aria-label="PIN" value={pin}
        onInput={(e) => setPin(e.currentTarget.value)} />
      {sock.error.value && <p class="pi-error" role="alert">{sock.error.value}</p>}
      <button type="submit" class="pad" disabled={!pin}>Unlock</button>
    </form>);
}

function Output({ out }: { out: PiState['out'] }) {
  const share = Math.min(1, out.genW / out.gen);
  return (
    <div class="pi-out">
      <div class="pi-gen" title="The generator's draw against its budget, after the power limiter">
        <span class={cx('pi-gen-fill', share > 0.9 && 'hot')} style={{ width: `${(share * 100).toFixed(1)}%` }} />
        <span class="pi-gen-text">Generator {out.genW.toFixed(0)} W of {out.gen} (peak {out.genPeakW.toFixed(0)})</span>
      </div>
      <p class="pi-stats">{out.fps.toFixed(1)} fps · render {out.renderMs.toFixed(1)} ms ·{' '}
        {out.cut} {out.cut === 1 ? 'frame' : 'frames'} limited
        {out.ddpErrors ? ` · DDP errors ${out.ddpErrors}: ${out.lastError}` : ''}</p>
    </div>);
}

export function App() {
  const ref = useRef<PiSocket | null>(null);
  const sock = ref.current ??= piSocket();
  useEffect(() => () => sock.close(), []);
  const beat = useBeat(sock);
  const s = sock.state.value, look = s?.look, status = sock.status.value;
  if (sock.needPin.value) return <main class="live-control"><PinScreen sock={sock} /></main>;
  if (!s) return <main class="live-control"><p class="pi-wait">Connecting to the Pi…</p></main>;
  const set = (c: Control) => (v: number) => sock.send({ type: 'set', name: c.name, value: v });
  // The tempo is tap tempo's, with a nudge either side when the look offers bpm, so not a fader as well.
  const bpm = look?.controls.find((c) => c.name === 'bpm');
  const controls = look?.controls.filter((c) => c !== bpm) ?? [];
  const nudge = (d: number) => () => bpm && sock.send({ type: 'set', name: 'bpm',
    value: Math.min(bpm.max, Math.max(bpm.min, look!.bpm + d)) });
  return (
    <main class="live-control">
      <div class="lc-head">
        <span class={cx('live-dot', status)} title={`Connection: ${status}`} />
        <h1>{look ? look.title : 'Nothing playing'}</h1>
        {s.switching && <span class="pi-sub">→ {s.looks.find((l) => l.id === s.switching)?.title}</span>}
      </div>
      {s.out.dryRun && <p class="pi-banner">Dry run: nothing is sent to the lights.</p>}
      {s.tripped && <p class="pi-banner trip" role="alert">The flash guard caught {s.looks.find((l) => l.id
        === s.tripped!.look)?.title ?? s.tripped.look} flashing, so the safe look is playing. Pick a look to go on.</p>}
      {sock.error.value && <p class="pi-error" role="alert" onClick={() => { sock.error.value = ''; }}>
        {sock.error.value}</p>}
      <button type="button" class={cx('pad lc-blackout', s.blackout && 'on')} aria-pressed={s.blackout}
        onClick={() => sock.send({ type: 'blackout', on: !s.blackout })}>
        {s.blackout ? 'Blackout on' : 'Blackout'}</button>
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
      <h2>Looks</h2>
      <div class="pi-looks">
        {s.looks.map((l) => <button type="button" key={l.id} disabled={!l.playable} title={l.error}
          class={cx('pad pi-look', l.id === look?.id && 'current')} aria-pressed={l.id === look?.id}
          onClick={() => sock.send({ type: 'play', id: l.id })}>{l.title}</button>)}
      </div>
      <h2>Output</h2>
      <Output out={s.out} />
    </main>);
}
