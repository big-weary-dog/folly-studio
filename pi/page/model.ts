// What the live play page (SPEC-liveplay "The page") reads from the socket: the mode, who this page is and whether it
// drives, watches or has lost the link, and the words for times, names and the queue's timing.
import { useEffect, useRef, useState } from 'preact/hooks';

import type { PiState, QueueItem } from '../src/protocol.ts';
import type { PiSocket } from './socket.ts';

export const clock = (s: number) => {
  const n = Math.max(0, Math.round(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};
export const label = (name: string) => (name === 'level' ? 'Look level'
  : name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]/g, ' '));
export const ordinal = (n: number) =>
  `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}`;

/** The page's view of the lights now. */
export function model(s: PiState, sock: PiSocket) {
  const me = sock.you.value, lost = sock.status.value !== 'open';
  const live = s.mode === 'live', mine = !!me && s.driver?.name === me.name;
  const drive = live && !!me?.drive && !lost;
  return {
    s, me, lost, live,
    /** May use the knobs now: this page drives, or nobody does and it may. */
    knobs: drive && (mine || !s.driver),
    /** Someone else has the knobs. */
    watching: live && !!s.driver && !mine,
    /** May play a look now and black out. */
    drive,
    mine,
    others: s.here.filter((n) => n !== me?.name),
    next: s.queue[0] ?? null,
  };
}
export type Model = ReturnType<typeof model>;

/** Seconds until this look ends: once something is queued, it ends at the end of its pattern's run. */
const ends = (s: PiState) => s.look?.left ?? (s.look ? Math.max(0, s.look.duration - s.look.t) : 0);
/** Seconds until each queued look starts: what is left of this one, then each before it. */
export function etas(s: PiState) {
  let t = ends(s);
  return s.queue.map((q) => { const at = t; t += q.duration ?? 0; return at; });
}
export const allIn = (s: PiState) => ends(s) + s.queue.reduce((n, q) => n + (q.duration ?? 0), 0);

export const kindWord = (q: Pick<QueueItem, 'kind'>) => (q.kind === 'look' ? 'the lights\' own'
  : q.kind === 'baked' ? 'Baked' : 'Live');

/** A re-render every `ms` while `on`: for times said in seconds. */
export function useTick(on = true, ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [on, ms]);
}

/** How many `size` px rows (with `gap` between) `el`'s height holds, kept as it resizes. */
export function useFits(size: number, gap: number) {
  const ref = useRef<HTMLElement>(null), [fits, setFits] = useState(4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setFits(Math.max(1, Math.floor((el.clientHeight + gap) / (size + gap)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, fits] as const;
}

/** Seconds since the state came, for its `ago`s. */
export const since = (sock: PiSocket) => (performance.now() - sock.at.value) / 1000;
