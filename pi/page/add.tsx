// Add a look (SPEC-liveplay "The page"): a search, where from (the lights' own looks; in Studio, one's own and the
// gallery's too), tiles a page at a time, a look that cannot play dashed with why. In Jukebox, and for those who may
// not drive, a pick asks Play next or Add to the end; a driver in Live Play cues it instead (Cue): a crossfade
// length, then Fade to it, Play next instead, or Cancel. Nothing changes until one is pressed.
import { useEffect, useState } from 'preact/hooks';

import { cx } from '../../public/js/ui/kit.tsx';
import type { PiState } from '../src/protocol.ts';
import { allIn, clock, kindWord, type Model, ordinal, useFits } from './model.ts';
import type { PiSocket } from './socket.ts';

export type Tile = { id: string, title: string, by: string, duration: number | null,
  kind?: 'look' | 'live' | 'baked', error?: string };
/** Where looks come from: its tiles (the lights' own, from the state) or a load (Studio's, fetched as the page opens
 * it), and how one is added. */
export type Source = { label: string, tiles?: (s: PiState) => Tile[], load?: () => Promise<Tile[]>,
  add: (t: Tile, at: 'now' | 'next' | 'end', fade?: number) => Promise<unknown> | unknown };
const TILE = 88, GAP = 8, MAX_QUEUE = 20, FADES = [1, 4, 8];

/** The engine's own looks, over the socket. */
export const ownSource = (sock: PiSocket): Source => ({
  label: 'The lights\' own',
  tiles: (s) => s.looks.map((l) => ({ id: l.id, title: l.title, by: 'the lights\' own', duration: l.duration,
    kind: 'look' as const, ...l.playable ? {} : { error: l.error ?? 'Cannot play' } })),
  add: (t, at, fade) => sock.send(at === 'now' ? { type: 'play', id: t.id, ...fade ? { fade } : {} }
    : { type: 'queue', id: t.id, at }),
});

export function AddLook({ m, sources, wide, onBack, onCue }: { m: Model, sources: Source[], wide?: boolean,
  onBack?: () => void, onCue: (t: Tile, from: Source) => void }) {
  const { s } = m;
  const [from, setFrom] = useState(0), [q, setQ] = useState(''), [page, setPage] = useState(0);
  const [picked, setPicked] = useState<Tile | null>(null), [error, setError] = useState('');
  const [loaded, setLoaded] = useState<Tile[] | null>(null);
  const source = sources[from]!;
  useEffect(() => {
    if (!source.load) return undefined;
    let live = true;
    setLoaded(null);
    source.load().then((t) => { if (live) setLoaded(t); }, (e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [from]);
  const all = source.tiles ? source.tiles(s) : loaded, words = q.trim().toLowerCase();
  const found = (all ?? []).filter((t) => `${t.title} ${t.by}`.toLowerCase().includes(words));
  const cols = wide ? 3 : 2, [ref, rows] = useFits(TILE, GAP), per = cols * rows;
  const pages = Math.max(1, Math.ceil(found.length / per)), at = Math.min(page, pages - 1);
  const full = s.queue.length >= MAX_QUEUE;
  const pick = (t: Tile) => {
    setError('');
    if (m.drive) onCue(t, source);
    else setPicked(t);
  };
  async function add(at: 'next' | 'end') {
    try {
      await source.add(picked!, at);
      setPicked(null);
      onBack?.();
    } catch (e) { setError((e as Error).message); }
  }
  const note = (t: Tile) => {
    if (t.error) return t.error;
    const i = s.queue.findIndex((x) => x.id === t.id);
    const where = s.look?.id === t.id ? 'playing now' : i >= 0 ? `queued ${ordinal(i + 1)}` : null;
    const tag = where ?? (t.kind && t.kind !== 'look' ? <span class="lp-tag">{kindWord(t as { kind: 'live' | 'baked' })}
    </span> : null);
    return <>{t.by}{t.duration != null && ` · ${clock(t.duration)}`}{tag && <> · {tag}</>}</>;
  };
  return <>
    <div class="lp-h2">
      {wide ? <h2>Add a look</h2> : <h1 class="lp-h1">Add a look</h1>}
      {wide ? <span class="lp-note">The queue holds {MAX_QUEUE} · {MAX_QUEUE - s.queue.length} places left</span>
        : onBack && <button type="button" class="lp-pad" onClick={onBack}>Back</button>}
    </div>
    <label class="lp-search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" /></svg><input type="search" placeholder="Find a look or a person" aria-label="Find a look"
      value={q}
      onInput={(e) => { setQ(e.currentTarget.value); setPage(0); }} /></label>
    {sources.length > 1 && <div class="lp-chips" role="group" aria-label="Where from">
      {sources.map((src, i) => <button key={src.label} type="button" class="lp-chip" aria-pressed={i === from}
        onClick={() => { setFrom(i); setPage(0); setPicked(null); }}>{src.label}</button>)}
    </div>}
    <div class={cx('lp-grid', wide && 'wide')} ref={ref as never}>
      {!all && !error && <p class="lp-note">Loading…</p>}
      {all && !found.length && <p class="lp-note">{all.length ? 'No look matches.' : 'No looks here yet.'}</p>}
      {found.slice(at * per, at * per + per).map((t) => <button key={t.id} type="button"
        class={cx('lp-tile', t.error && 'off')} disabled={!!t.error || m.lost} aria-pressed={picked?.id === t.id}
        onClick={() => pick(t)}><b>{t.title}</b><small>{note(t)}</small></button>)}
    </div>
    <div class="lp-h2">
      <button type="button" class="lp-pad lp-pg" aria-label="Previous page" disabled={at === 0}
        onClick={() => setPage(at - 1)}>‹</button>
      <span class="lp-note">Page {at + 1} of {pages} · {found.length} {found.length === 1 ? 'look' : 'looks'}</span>
      <button type="button" class="lp-pad lp-pg" aria-label="Next page" disabled={at >= pages - 1}
        onClick={() => setPage(at + 1)}>›</button>
    </div>
    {error && <p class="lp-error" role="alert">{error}</p>}
    {picked && <div class="lp-conf" role="region" aria-label={`Add ${picked.title}`}>
      <p><b>{picked.title}</b> plays{picked.kind === 'baked' ? ' its bake' : picked.kind === 'live' ? ' live' : ''}
        {picked.duration != null && ` for ${clock(picked.duration)}`}, then the next fades in.{full
        ? ' The queue is full.' : ` At the end of the queue it starts in about ${clock(allIn(s))}.`}</p>
      <div class="lp-row">
        <button type="button" class="lp-pad" disabled={full} onClick={() => void add('next')}>Play next</button>
        <button type="button" class="lp-pad pri" disabled={full} onClick={() => void add('end')}>Add to the end
        </button>
      </div>
    </div>}
  </>;
}

/** A look cued in Live Play: not on the lights until Fade to it (or Play next instead). */
export function Cue({ m, tile, from, onDone }: { m: Model, tile: Tile, from: Source, onDone: () => void }) {
  const [fade, setFade] = useState(4), [error, setError] = useState('');
  const go = async (at: 'now' | 'next') => {
    try {
      await from.add(tile, at, at === 'now' ? fade : undefined);
      onDone();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <section class="lp-cue" aria-label="Cued look">
      <div class="lp-kick sand"><span>Cued · not on the lights yet</span></div>
      <h2>{tile.title}</h2>
      <p>{tile.by}{tile.duration != null && ` · ${clock(tile.duration)}`}{tile.kind && tile.kind !== 'look'
        && <> · <span class="lp-tag">{kindWord(tile as { kind: 'live' | 'baked' })}</span></>}</p>
      <span class="lp-lbl">Crossfade</span>
      <div class="lp-seg" role="group" aria-label="Crossfade length">
        {FADES.map((f) => <button key={f} type="button" aria-pressed={fade === f} onClick={() => setFade(f)}>
          {f} s</button>)}
      </div>
      <div class="lp-xf" aria-hidden="true"><i /><span>{m.s.look?.title ?? 'Nothing'}</span><span>{tile.title}</span>
      </div>
      <p>{tile.kind === 'baked' ? 'A bake has no knobs.' : 'Its knobs take over when the fade ends.'} The queue goes
        on after it.</p>
      {error && <p class="lp-error" role="alert">{error}</p>}
      <div class="lp-row lp-cue-acts">
        <button type="button" class="lp-pad lp-cancel" onClick={onDone}>Cancel</button>
        <button type="button" class="lp-pad" disabled={m.lost} onClick={() => void go('next')}>Play next instead
        </button>
      </div>
      <button type="button" class="lp-pad pri lp-commit" disabled={m.lost} onClick={() => void go('now')}>
        Fade to {tile.title} · {fade} s</button>
    </section>);
}
