// Live Play's show row and Blackout bar (SPEC-liveplay "The page"). Master is a horizontal fader ("Master, when
// back" while dark); Tap sets the tempo and the downbeat, ± 1 BPM when the look offers its tempo, and a bake's is
// fixed. Blackout is a press-and-hold of HOLD_MS either way (B on a keyboard): the bar fills, letting go cancels.
import { useEffect, useRef, useState } from 'preact/hooks';

import { cx } from '../../public/js/ui/kit.tsx';
import { useDrag } from './drag.ts';
import type { Model } from './model.ts';
import type { PiSocket } from './socket.ts';

export const HOLD_MS = 500;

/** Lit through the first quarter of each beat, as the engine counts them, on `el` itself: no render a frame. */
function useBeat(sock: PiSocket) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const l = sock.state.peek()?.look;
      const beats = l ? l.beats + (performance.now() - sock.at.peek()) / 1000 * l.bpm / 60 : 0;
      el.current?.classList.toggle('on', !!l && beats - Math.floor(beats) < 0.25);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return el;
}

export function ShowRow({ m, sock }: { m: Model, sock: PiSocket }) {
  const { s } = m, look = s.look, locked = !m.knobs;
  const beat = useBeat(sock);
  const f = useDrag({ min: 0, max: 1, value: s.level, axis: 'x', locked,
    send: (value) => sock.send({ type: 'level', value }) });
  const bpm = look?.controls.find((c) => c.kind === 'bpm');
  const nudge = (d: number) => () => bpm?.kind === 'bpm' && sock.send({ type: 'set', name: 'bpm',
    value: Math.min(bpm.max, Math.max(bpm.min, look!.bpm + d)) });
  const tap = () => sock.send({ type: 'tap', at: performance.now() });
  const name = s.blackout.on ? 'Master, when back' : 'Master';
  const bpmText = look ? `${look.bpm.toFixed(1)} BPM` : '';
  return (
    <div class="lp-show">
      <div class={cx('lp-master', locked && 'locked')} aria-label={s.blackout.on
        ? 'Master, for when the lights come back' : 'Master'} aria-valuetext={`${Math.round(f.value * 100)}%`}
        {...f.props}>
        <i style={{ width: `${(f.share * 100).toFixed(1)}%` }} /><span>{name}</span>
        <span class="lp-v">{Math.round(f.value * 100)}%</span>
      </div>
      {s.blackout.on ? null : !look || look.kind === 'baked'
        ? <button type="button" class="lp-pad lp-tap fixed" disabled><span>Tap</span>
          <small>{look ? 'Tempo fixed by the bake' : 'Nothing playing'}</small></button>
        : locked ? <span class="lp-pad lp-tap locked"><span class="lp-beat" ref={beat} /><span>Tempo</span>
          <small>{bpmText}</small></span>
          : <>
            {bpm && <button type="button" class="lp-pad lp-nudge" aria-label="Slower by 1 BPM" onClick={nudge(-1)}>
              −</button>}
            <button type="button" class={cx('lp-pad lp-tap', !bpm && 'wide')}
              onPointerDown={(e) => { e.preventDefault(); tap(); }}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); tap(); } }}>
              <span class="lp-beat" ref={beat} /><span class="lp-tap-text"><span>Tap</span><small>{bpmText}</small>
              </span></button>
            {bpm && <button type="button" class="lp-pad lp-nudge" aria-label="Faster by 1 BPM" onClick={nudge(1)}>
              +</button>}
          </>}
    </div>);
}

/** `stop`: where to stop the lights on site when this page cannot reach them. */
export function BlackoutBar({ m, sock, wide, stop }: { m: Model, sock: PiSocket, wide?: boolean, stop: string }) {
  const on = m.s.blackout.on;
  const [left, setLeft] = useState<number | null>(null);   // ms of the hold still to go
  const hold = useRef({ start: 0, raf: 0 });
  const able = m.drive;
  const cancel = () => {
    cancelAnimationFrame(hold.current.raf);
    hold.current.start = 0;
    setLeft(null);
  };
  const begin = () => {
    if (!able || hold.current.start) return;
    hold.current.start = performance.now();
    const step = () => {
      const rest = HOLD_MS - (performance.now() - hold.current.start);
      if (rest <= 0) {
        sock.send({ type: 'blackout', on: !on });
        cancel();
        return;
      }
      setLeft(rest);
      hold.current.raf = requestAnimationFrame(step);
    };
    step();
  };
  const latest = useRef({ begin, cancel });
  latest.current = { begin, cancel };
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement
      && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    const down = (e: KeyboardEvent) => {
      if ((e.key === 'b' || e.key === 'B') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e)) {
        latest.current.begin();
      }
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'b' || e.key === 'B') latest.current.cancel(); };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', latest.current.cancel);
    return () => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      removeEventListener('blur', latest.current.cancel);
      cancelAnimationFrame(hold.current.raf);
    };
  }, []);
  if (!able) {
    return <button type="button" class="lp-bo off" disabled>
      <span>{m.lost ? 'Blackout can\'t reach the lights' : 'Blackout is for those who drive'}
        {m.lost && <small>{stop}</small>}</span></button>;
  }
  const share = left == null ? 0 : 1 - left / HOLD_MS;
  return (
    <div class="lp-bo-wrap">
      {left != null && <p class="lp-hint" role="status">Keep holding: the lights {on ? 'come back' : 'go dark'} in
        {' '}{(left / 1000).toFixed(1)} s. Let go to cancel.</p>}
      <button type="button" class={cx('lp-bo', on && 'on', left != null && 'arming')} aria-pressed={on}
        aria-describedby="lp-bo-hint" onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          begin();
        }} onPointerUp={cancel} onPointerCancel={cancel} onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(); }
        }}
        onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') cancel(); }}>
        {!on && <span class="lp-ring" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 3v8" />
          <path d="M6.3 6.8a8 8 0 1 0 11.4 0" /></svg></span>}
        <span class="lp-bo-text">{on ? 'Bring the lights back' : 'Black out the lights'}</span>
        <small id="lp-bo-hint">{left != null ? `${(left / 1000).toFixed(1)} s`
          : on ? 'Hold · fades in 0.3 s' : wide ? 'Hold, or B' : 'Press and hold'}</small>
        {/* What the hold has filled: the same words, inked, revealed left to right. */}
        {left != null && <span class="lp-bo-ink" aria-hidden="true"
          style={{ clipPath: `inset(0 ${((1 - share) * 100).toFixed(1)}% 0 0)` }}>
          <span class="lp-bo-text">{on ? 'Bring the lights back' : 'Black out the lights'}</span>
          <small>{(left / 1000).toFixed(1)} s</small></span>}
      </button>
    </div>);
}
