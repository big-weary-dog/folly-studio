// The Pi's control page: one column of big targets for a phone in the dark. Blackout first, then the master, the tap
// pad, the playing look's own controls and every look to play or queue (controls.tsx), the queue (queue.tsx), and
// what the Pi is sending. A flash-guard trip and a dry run each say so at the top.
import { useEffect, useRef } from 'preact/hooks';

import { cx } from '../../public/js/ui/kit.tsx';
import type { PiState } from '../src/protocol.ts';
import { Alerts, Blackout, Controls, Looks, PinScreen } from './controls.tsx';
import { UpNext } from './queue.tsx';
import { piSocket, type PiSocket } from './socket.ts';

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
  const s = sock.state.value, look = s?.look, status = sock.status.value;
  if (sock.needPin.value) return <main class="live-control"><PinScreen sock={sock} /></main>;
  if (!s) return <main class="live-control"><p class="pi-wait">Connecting to the Pi…</p></main>;
  return (
    <main class="live-control">
      <div class="lc-head">
        <span class={cx('live-dot', status)} title={`Connection: ${status}`} />
        <h1>{look ? look.title : 'Nothing playing'}</h1>
        {s.switching && <span class="pi-sub">→ {s.switching.title}</span>}
      </div>
      {s.out.dryRun && <p class="pi-banner">Dry run: nothing is sent to the lights.</p>}
      {sock.driver.value && <p class="pi-driver" role="status">Studio's Live tab: {sock.driver.value === 'pi'
        ? 'driven from /pi.' : 'driven from Live control. Use a control here to take it.'}</p>}
      <Alerts s={s} sock={sock} />
      <Blackout s={s} sock={sock} />
      <Controls s={s} sock={sock} />
      <UpNext s={s} sock={sock} />
      <h2>Looks</h2>
      <Looks s={s} sock={sock} />
      <h2>Output</h2>
      <Output out={s.out} />
    </main>);
}
