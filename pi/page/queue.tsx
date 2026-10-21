// The control page's jukebox (SPEC-offline "Playing on the lights"): what plays next, in order, with who queued each;
// ↑ moves one up, × takes it off, Skip goes to the next now. Looks from Studio say who sent them.
import { cx } from '../../public/js/ui/kit.tsx';
import type { PiState } from '../src/protocol.ts';
import type { PiSocket } from './socket.ts';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function UpNext({ s, sock }: { s: PiState, sock: PiSocket }) {
  const left = s.look?.left;
  return <>
    <div class="pi-next-head">
      <h2>Up next</h2>
      {left != null && <span class="pi-sub">{clock(left)} left of this one</span>}
      <button type="button" class="pad pi-skip" disabled={!s.queue.length}
        onClick={() => sock.send({ type: 'next' })}>Skip</button>
    </div>
    {s.paused && s.queue.length > 0 && <p class="pi-sub">Paused by the flash guard: Skip goes on.</p>}
    {s.queue.length ? <ol class="pi-queue">
      {s.queue.map((q, i) => <li key={q.key} class={cx('pi-queued', q.kind)}>
        <span class="pi-queued-title">{q.title}
          {q.by && <span class="pi-sub"> · {q.by}</span>}</span>
        <button type="button" class="pad pi-mini" aria-label={`Move ${q.title} up`} disabled={i === 0}
          onClick={() => sock.send({ type: 'move', key: q.key, to: i - 1 })}>↑</button>
        <button type="button" class="pad pi-mini" aria-label={`Take ${q.title} off`}
          onClick={() => sock.send({ type: 'unqueue', key: q.key })}>×</button>
      </li>)}
    </ol> : <p class="pi-sub">Nothing queued: this look loops on. Queue looks below, or from Studio's Play on the
      lights.</p>}
  </>;
}
