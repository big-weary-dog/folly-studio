// The live play page (SPEC-liveplay "The page"): one skeleton at every size, and nothing scrolls. On a phone, top to
// bottom: the status strip, the now card, the mode's surface (Jukebox: the queue or Add a look; Live Play: the bank,
// or the queue, Add a look or a cued look), and in Live Play the show row and Blackout. From 1024 px, three columns:
// the now card and the queue; the surface and the show row; the aside (the Pi's output, or Studio's 3D stage) and
// Blackout. The aside opens over the page from the strip's menu on a phone. Used by the Pi's own page (app.tsx) and
// Studio's /live on the Pi.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { cx } from '../../public/js/ui/kit.tsx';
import { AddLook, Cue, type Source, type Tile } from './add.tsx';
import { Bank } from './bank.tsx';
import { model } from './model.ts';
import { Queue } from './queue.tsx';
import { BlackoutBar, ShowRow } from './show.tsx';
import type { PiSocket } from './socket.ts';
import { Banners, NowCard, PinScreen, Refusal, StatusStrip } from './status.tsx';

const WIDE = '(min-width: 1024px)';
type View = 'main' | 'queue' | 'add' | 'cue';

function useWide() {
  const [wide, set] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = matchMedia(WIDE), on = () => set(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/** `aside`: what the third column holds, `onShown` told when it shows or hides; `stop`: where to stop the lights on
 * site when this page cannot reach them. */
export function Controller({ sock, sources, aside, stop, title }: { sock: PiSocket, sources: Source[],
  aside: { label: string, node: ComponentChildren, onShown?: (shown: boolean) => void }, stop: string,
  title: string }) {
  const wide = useWide();
  const [view, setView] = useState<View>('main'), [cue, setCue] = useState<{ tile: Tile, from: Source } | null>(null);
  const [open, setOpen] = useState(false);
  const shown = wide || open;
  useEffect(() => aside.onShown?.(shown), [shown]);
  const s = sock.state.value, mode = s?.mode;
  // A mode change puts away what the other mode had open.
  useEffect(() => { setView('main'); setCue(null); }, [mode]);
  const side = <aside class={cx('lp-aside', open && 'open')} aria-label={aside.label}
    hidden={!shown}>{!wide && <button type="button" class="lp-pad lp-close" onClick={() => setOpen(false)}>
      Close</button>}{aside.node}</aside>;
  if (sock.needPin.value || !s) {
    return <main class="lp">{sock.needPin.value ? <PinScreen sock={sock} title={title} />
      : <p class="lp-wait" role="status">Connecting to the lights…</p>}{side}</main>;
  }
  const m = model(s, sock), live = m.live;
  const done = () => { setView('main'); setCue(null); };
  // Add a look is reached from the queue, so goes back to it (on a laptop the queue is always there).
  const add = <AddLook m={m} sources={sources} wide={wide} onBack={wide ? (live ? done : undefined)
    : () => setView(live ? 'queue' : 'main')}
    onCue={(tile, from) => { setCue({ tile, from }); setView('cue'); }} />;
  const cued = cue && <Cue m={m} tile={cue.tile} from={cue.from} onDone={done} />;
  const strip = <StatusStrip m={m} sock={sock}
    aside={wide ? undefined : { label: aside.label, open, toggle: () => setOpen(!open) }} />;
  const show = live && <ShowRow m={m} sock={sock} />, bo = live && <BlackoutBar m={m} sock={sock} wide={wide}
    stop={stop} />;
  const frame = cx('lp', live ? 'live' : 'jukebox', s.blackout.on && 'dark', wide && 'wide');
  if (wide) {
    return (
      <main class={frame}>
        {strip}
        <Refusal sock={sock} />
        <Banners m={m} sock={sock} />
        <div class="lp-cols">
          <div class="lp-col">
            <NowCard m={m} sock={sock} next={!live} />
            <Queue m={m} sock={sock} wide onAdd={() => setView('add')} />
          </div>
          <div class="lp-col">
            {!live || view === 'add' ? add : view === 'cue' && cued ? cued : <Bank m={m} sock={sock} wide />}
            {show}
          </div>
          <div class="lp-col">{side}{bo}</div>
        </div>
      </main>);
  }
  const toQueue = { open: view === 'queue', toggle: () => setView(view === 'queue' ? 'main' : 'queue') };
  const surface = view === 'add' ? add
    : live && view === 'cue' && cued ? <><NowCard m={m} sock={sock} toQueue={toQueue} />{cued}</>
      : !live || view === 'queue' ? <><NowCard m={m} sock={sock} toQueue={live ? toQueue : undefined} />
        <Queue m={m} sock={sock} onAdd={() => setView('add')} /></>
        : <><NowCard m={m} sock={sock} toQueue={toQueue} /><Bank m={m} sock={sock} /></>;
  return (
    <main class={frame}>
      {strip}
      <Refusal sock={sock} />
      <Banners m={m} sock={sock} />
      {surface}
      {show}
      {bo}
      {side}
    </main>);
}
