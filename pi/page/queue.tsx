// The queue (SPEC-liveplay "The page"): what plays next, numbered, with who queued it, what it is, its length and
// when it starts; ↑ moves one up, × takes it off, Fade to next goes on now. As many rows as the height left holds;
// past them, "N more" pages on. The flash guard's pause says so.
import { useEffect, useRef, useState } from 'preact/hooks';

import { cx } from '../../public/js/ui/kit.tsx';
import { allIn, clock, etas, kindWord, type Model } from './model.ts';
import type { PiSocket } from './socket.ts';

const ROW = 56, GAP = 6;

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

const Arrow = ({ d }: { d: string }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={d} /></svg>;

export function Queue({ m, sock, onAdd, wide }: { m: Model, sock: PiSocket, onAdd: () => void, wide?: boolean }) {
  const { s } = m, q = s.queue, when = etas(s);
  const [ref, fits] = useFits(ROW, GAP), [page, setPage] = useState(0);
  // The last row says "N more" when they do not all fit.
  const per = q.length > fits ? Math.max(1, fits - 1) : fits, pages = Math.max(1, Math.ceil(q.length / per));
  const at = Math.min(page, pages - 1), shown = q.slice(at * per, at * per + per), rest = q.length - at * per - per;
  const loops = s.look?.left == null;
  return <>
    <div class="lp-h2">
      <h2><span class="lp-nw">Up next · {q.length}</span>{q.length > 0 && !loops
        && <> <span class="lp-nw">· {clock(allIn(s))} in all</span></>}</h2>
      {s.paused && <span class="lp-pill">Paused</span>}
      <span class="lp-h2-acts">
        <button type="button" class="lp-pad" disabled={!q.length || m.lost}
          onClick={() => sock.send({ type: 'next' })}><Arrow d="M5 5l9 7-9 7zM18 5v14" />Fade to next</button>
        {wide && <button type="button" class="lp-pad pri" disabled={m.lost} onClick={onAdd}>Add a look</button>}
      </span>
    </div>
    <ol class={cx('lp-queue', m.lost && 'hatched')} ref={ref as never} start={at * per + 1}>
      {!q.length && <li class="lp-q-empty">Nothing queued: {s.look ? `${s.look.title} loops on.` : 'add a look.'}</li>}
      {shown.map((item, j) => {
        const i = at * per + j;
        return <li key={item.key} class="lp-q">
          <span class="lp-qn">{i + 1}</span>
          <span class="lp-qt"><b>{item.title}</b><small>{item.by && `${item.by} · `}
            {item.kind === 'look' ? kindWord(item) : <span class="lp-tag">{kindWord(item)}</span>}
            {item.duration != null && ` ${clock(item.duration)}`}</small></span>
          {!loops && <span class="lp-eta">in<br />{clock(when[i]!)}</span>}
          <button type="button" class="lp-pad lp-mini" aria-label={`Move ${item.title} up`} disabled={i === 0 || m.lost}
            onClick={() => sock.send({ type: 'move', key: item.key, to: i - 1 })}><Arrow d="M12 19V5M6 11l6-6 6 6" />
          </button>
          <button type="button" class="lp-pad lp-mini" aria-label={`Take ${item.title} off`} disabled={m.lost}
            onClick={() => sock.send({ type: 'unqueue', key: item.key })}><Arrow d="M6 6l12 12M18 6L6 18" /></button>
        </li>;
      })}
      {pages > 1 && <li><button type="button" class="lp-pad lp-qmore" onClick={() => setPage((at + 1) % pages)}>
        {rest > 0 ? `${rest} more${loops ? '' : `, to ${clock(allIn(s))}`}` : 'Back to the first'}
        <Arrow d={rest > 0 ? 'M9 6l6 6-6 6' : 'M12 19V5M6 11l6-6 6 6'} /></button></li>}
    </ol>
    {!wide && <button type="button" class="lp-pad pri lp-add" disabled={m.lost} onClick={onAdd}>
      <Arrow d="M12 5v14M5 12h14" />Add a look</button>}
  </>;
}
