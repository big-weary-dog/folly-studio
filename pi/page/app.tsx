// The Pi's control page (pi/README.md "The control page"): the live play page (controller.tsx) with the lights' own
// looks to add, and what the Pi is sending as its aside.
import { useEffect, useRef } from 'preact/hooks';

import { cx } from '../../public/js/ui/kit.tsx';
import type { PiState } from '../src/protocol.ts';
import { ownSource } from './add.tsx';
import { Controller } from './controller.tsx';
import { piSocket, type PiSocket } from './socket.ts';

export const STOP_ON_SITE = 'On site: switch the ops hub back to FPP';

/** `studio`: behind Studio's proxy, who drives its Live tab (SPEC-live "Following /pi"). */
export function Output({ s, studio }: { s: PiState | null, studio?: 'pi' | 'live' | null }) {
  if (!s) return <p class="lp-note">Waiting for the lights…</p>;
  const { out } = s, share = Math.min(1, out.genW / out.gen);
  const rows: [string, string][] = [
    ['Generator', `${(out.genW / 1000).toFixed(1)} of ${(out.gen / 1000).toFixed(1)} kW`],
    ['Peak', `${(out.genPeakW / 1000).toFixed(1)} kW`],
    ['Power limiter', out.cut ? `Limited ${out.cut} ${out.cut === 1 ? 'frame' : 'frames'}` : 'Not limiting'],
    ['Flash guard', s.tripped ? 'Caught a look' : 'Watching'],
    ['Frames', `${out.fps.toFixed(1)} fps · render ${out.renderMs.toFixed(1)} ms`],
    ...out.dryRun ? [['Dry run', 'Nothing is sent to the lights'] as [string, string]] : [],
    ...studio ? [['Studio\'s Live tab', studio === 'pi' ? 'Driven from /pi'
      : 'Driven from Live control'] as [string, string]] : [],
    ...out.ddpErrors ? [['DDP errors', `${out.ddpErrors}: ${out.lastError}`] as [string, string]] : [],
  ];
  return (
    <div class="lp-out">
      <div class="lp-gen" title="The generator's draw against its budget, after the power limiter">
        <span class={cx('lp-gen-fill', share > 0.9 && 'hot')} style={{ width: `${(share * 100).toFixed(1)}%` }} />
      </div>
      <dl class="lp-stats">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </div>);
}

export function App() {
  const ref = useRef<PiSocket | null>(null);
  const sock = ref.current ??= piSocket();
  useEffect(() => () => sock.close(), []);
  return <Controller sock={sock} sources={[ownSource(sock)]} title="Studio Live" stop={STOP_ON_SITE}
    aside={{ label: 'Output', node: <Output s={sock.state.value} studio={sock.driver.value} /> }} />;
}
