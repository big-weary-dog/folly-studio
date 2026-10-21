// Relay to the lights from the editor (SPEC-live "From Studio's editor"): the preview's own sandbox renders the look
// as it stands, saved or not, ahead in the Worker, over whatever the lights play. The Worker follows the playhead by
// its anchor (show time at a moment, the speed, playing or not), sent again whenever the playhead does other than run
// on: a play, a pause, a seek, a new speed or length. A hidden tab's Worker keeps rendering; shown again, the playhead
// catches up with what the lights play.
import { effect } from '@preact/signals';

import type { RelayClock } from '../relay-ahead.ts';
import type { Preview } from './preview.ts';
import { createRelayLink, epoch } from './relay-link.ts';
import type { Studio } from './studio-store.ts';

const DRIFT = 0.05;     // s the playhead may differ from the anchor's before it counts as a seek

/** The anchor's show time at epoch ms `at`. */
export function clockNow(k: RelayClock, at = epoch()) {
  if (!k.playing) return k.t;
  const t = k.t + (at - k.at) / 1000 * k.speed;
  return k.duration > 0 ? ((t % k.duration) + k.duration) % k.duration : t;
}

export function createStudioRelay(st: Studio, pv: Preview) {
  let k: RelayClock | null = null, unhook: (() => void)[] = [];
  const anchor = () => {
    k = { t: st.clock.t, at: epoch(), speed: st.speed.peek(), playing: st.playing.peek(), duration: pv.duration.peek() };
    link.nudge();
  };
  // Shown again: the playhead to where the lights are, before the preview's next frame.
  const shown = () => { if (!document.hidden && k) pv.seek(clockNow(k)); };
  const link = createRelayLink({
    over: true,
    async begin() {
      const runtime = pv.runtime, rig = st.data.rig;
      if (!runtime?.ready || !rig) return 'The preview is not ready yet.';
      anchor();
      unhook = [
        effect(() => { void st.playing.value; void st.speed.value; void pv.duration.value; anchor(); }),
        pv.onFrame((t) => {
          if (!k) return;
          const d = Math.abs(t - clockNow(k)), len = k.duration;
          if (Math.min(d, len > 0 ? len - d : d) > DRIFT) anchor();
        }),
      ];
      document.addEventListener('visibilitychange', shown);
      return { runtime, count: rig.count, fps: rig.output?.fps || 40 };
    },
    word: (_s, base) => (k ? { on: true, rev: 0, next: 0, frame: 0, duration: k.duration, set: null, clock: k,
      ...base } : null),
    end() {
      for (const u of unhook) u();
      unhook = [];
      document.removeEventListener('visibilitychange', shown);
      k = null;
    },
  });
  return link;
}
