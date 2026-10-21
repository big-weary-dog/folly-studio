// The top of the live play page (SPEC-liveplay "The page"): the status strip (the mode, the link as a shape and a
// word, who drives and who is here), the now card, the banners for a flash-guard trip, a lost link and someone else
// on the knobs, the engine's last refusal, and the PIN screen.
import { useEffect, useState } from 'preact/hooks';

import { cx } from '../../public/js/ui/kit.tsx';
import { clock, type Model, since, useTick } from './model.ts';
import type { PiSocket } from './socket.ts';

const Chevron = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;

export function StatusStrip({ m, sock, aside }: { m: Model, sock: PiSocket,
  aside?: { label: string, open: boolean, toggle: () => void } }) {
  const { s, me, live } = m;
  const link = m.lost ? ['lost', 'Reconnecting'] : s.blackout.on ? ['dark', 'Blacked out']
    : [s.out.dryRun ? 'dry' : 'on', s.out.dryRun ? 'Dry run' : 'On the lights'];
  const others = m.others.length === 1 ? `${m.others[0]} is here too`
    : m.others.length ? `${m.others.length + 1} people here` : 'on your own';
  const first = !live ? <b>{me && me.name !== 'the Pi\'s page' ? me.name : 'You'}</b>
    : m.mine ? <b>You're driving</b> : s.driver ? <b>{s.driver.name} is driving</b>
      : m.lost && sock.you.value?.drive ? 'You were driving' : <b>Nobody is driving</b>;
  const second = live && !m.mine && (s.driver || !me?.drive) ? 'You\'re watching' : others;
  return (
    <header class="lp-top">
      <span class={cx('lp-mode', live ? 'live' : 'jukebox')}>{live ? 'Live Play' : 'Jukebox'}</span>
      <span class={cx('lp-link', link[0])} role="status" title={s.out.dryRun ? 'Dry run: nothing is sent to the lights'
        : undefined}><span class="lp-shape" aria-hidden="true" />{link[1]}</span>
      <span class="lp-who">{first}<br />{second}</span>
      {aside && <button type="button" class="lp-menu" aria-label={aside.label} aria-expanded={aside.open}
        onClick={aside.toggle}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>}
    </header>);
}

/** What plays: its title, the time left, and what is next (in Live Play, a way to the queue and back). */
export function NowCard({ m, sock, toQueue, next = true }: { m: Model, sock: PiSocket,
  toQueue?: { open: boolean, toggle: () => void }, next?: boolean }) {
  const { s, lost } = m, l = s.look;
  useTick(lost);
  const kicker = lost ? `Last seen ${clock(since(sock))} ago` : s.blackout.on ? 'Playing unseen' : 'On the lights now';
  const from = !l ? '' : l.kind === 'look' ? 'The lights\' own' : 'Studio';
  const left = l?.left == null ? null : Math.max(0, l.left - (lost ? since(sock) : 0));
  return (
    <section class={cx('lp-card', lost && 'hatched')} aria-label={kicker}>
      <div class="lp-kick"><span>{kicker}</span>
        <span>{from}{l?.kind === 'baked' && <> · <span class="lp-tag">Baked</span></>}</span></div>
      <h1 class="lp-title">{l ? l.title : 'Nothing playing'}</h1>
      {s.switching && <p class="lp-note">Switching to {s.switching.title}</p>}
      {l && (left != null && l.duration
        ? <div class="lp-prog" role="progressbar" aria-label={l.title} aria-valuemin={0} aria-valuemax={1}
          aria-valuenow={1 - left / l.duration}>
          <i style={{ width: `${(Math.min(1, 1 - left / l.duration) * 100).toFixed(1)}%` }} />
          <span>{lost && 'about '}{clock(left)} left</span><span>of {clock(l.duration)}</span></div>
        : <p class="lp-note">{s.tripped ? 'Plays until someone goes on or picks a look.'
          : 'Loops until something is queued.'}</p>)}
      {next && !lost && (toQueue
        ? <button type="button" class="lp-next" aria-expanded={toQueue.open} onClick={toQueue.toggle}>
          {toQueue.open ? <><span>Back to</span><b>the knobs</b></> : <><span>Up next</span>
            <b>{m.next?.title ?? 'nothing queued'}</b><span>{s.queue.length} queued</span></>}<Chevron /></button>
        : m.next && <div class="lp-next"><span>Then</span><b>{m.next.title}</b><span>1 s crossfade</span></div>)}
    </section>);
}

/** A flash-guard trip, a lost link, or someone else on the knobs. */
export function Banners({ m, sock }: { m: Model, sock: PiSocket }) {
  const { s } = m;
  useTick(m.lost || m.watching);
  if (m.lost) {
    const wait = Math.max(0, Math.ceil((sock.nextTry.value - performance.now()) / 1000));
    return (
      <div class="lp-ban" role="alert">
        <span class="lp-tri" aria-hidden="true">▲</span>
        <span><b>Can't reach the lights</b> They play on as they were. {sock.status.value === 'connecting'
          ? 'Trying now…' : `Trying again in ${wait} s (try ${sock.tries.value + 1}).`} Nothing here reaches them
          until they answer.</span>
        <button type="button" class="lp-pad" disabled={sock.status.value === 'connecting'}
          onClick={() => sock.retry()}>Try now</button>
      </div>);
  }
  if (s.tripped) {
    const caught = s.looks.find((l) => l.id === s.tripped!.look)?.title ?? s.tripped.look;
    return (
      <div class="lp-ban" role="alert">
        <span class="lp-tri" aria-hidden="true">▲</span>
        <span><b>The flash guard caught {caught} flashing.</b> The safe look is on{s.paused
          ? ', and the queue waits for you.' : '.'}</span>
        {s.paused && m.next && <button type="button" class="lp-pad" onClick={() => sock.send({ type: 'next' })}>
          Go on with {m.next.title}</button>}
      </div>);
  }
  if (m.watching) {
    const ago = s.driver!.ago + since(sock);
    return (
      <div class="lp-take" role="status">
        <span class="lp-lock" aria-hidden="true" />
        <span><b>{s.driver!.name} has the knobs.</b> You see them move as they play. Last touched {clock(ago)} ago.
        </span>
        {m.drive && <button type="button" class="lp-pad" onClick={() => sock.send({ type: 'take' })}>Take over</button>}
      </div>);
  }
  if (m.live && !m.me?.drive) {
    return <div class="lp-take" role="status"><span class="lp-lock" aria-hidden="true" /><span>You're watching:
      the knobs are for those who may drive the live stage. You can still queue looks.</span></div>;
  }
  return null;
}

/** The engine's last refusal, until tapped or 6 s on. */
export function Refusal({ sock }: { sock: PiSocket }) {
  const text = sock.error.value;
  useEffect(() => {
    if (!text) return undefined;
    const id = setTimeout(() => { if (sock.error.peek() === text) sock.error.value = ''; }, 6000);
    return () => clearTimeout(id);
  }, [text]);
  return text ? <p class="lp-refused" role="alert"><span>{text}</span>
    <button type="button" class="lp-x" aria-label="Dismiss" onClick={() => { sock.error.value = ''; }}>×</button></p>
    : null;
}

export function PinScreen({ sock, title = 'Studio Live' }: { sock: PiSocket, title?: string }) {
  const [pin, setPin] = useState('');
  return (
    <form class="lp-pin" onSubmit={(e) => { e.preventDefault(); sock.unlock(pin); setPin(''); }}>
      <h1>{title}</h1>
      <p>This Pi asks for a PIN before the page can change the lights.</p>
      <input type="password" inputMode="numeric" autoComplete="off" aria-label="PIN" value={pin}
        onInput={(e) => setPin(e.currentTarget.value)} />
      {sock.error.value && <p class="lp-error" role="alert">{sock.error.value}</p>}
      <button type="submit" class="lp-pad pri" disabled={!pin}>Unlock</button>
    </form>);
}
