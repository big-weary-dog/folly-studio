// Relay to the lights from the Live tab (SPEC-live "Relay to the lights"): its own sandbox renders the engine's look
// (its source, code from our library by ref) ahead in the Worker at the engine's slots, as the states say them, in
// place of the engine's own render.
import type { PiState } from '../../../../pi/page/socket.ts';
import type { PiSource } from '../../../../shared/schemas/live.ts';
import type { LiveSet } from '../../live-set.ts';
import { Runtime } from '../../runtime.ts';
import { loadLibrary, loadRig, normaliseLayers } from '../model.ts';
import { createRelayLink } from '../relay-link.ts';
import { piExtra, piLayers } from './follow-pi.ts';

export type { Relay } from '../relay-link.ts';
type Look = NonNullable<PiState['look']>;

/** What the engine has set on its look, from its state, for the Worker to set before each frame. */
export const relaySet = (l: Look): LiveSet => ({ bpm: l.bpm, beat0: l.beat0, offset: l.offset, paces: l.paces,
  values: Object.fromEntries(l.controls.filter((c) => c.kind === 'macro').map((c) => [c.name, c.value as number])) });

export function createRelay(host: () => HTMLElement | null) {
  let source: PiSource | null = null, sentRev = -1, rigNow: Awaited<ReturnType<typeof loadRig>> | null = null;
  let libraryNow: { name: string, kind?: string, code: string }[] = [], runtime: Runtime | null = null;
  const link = createRelayLink({
    async begin() {
      const [rig, lib] = await Promise.all([loadRig(), loadLibrary()]);
      const el = host();
      if (!el) return 'The Live tab is not showing.';
      rigNow = rig;
      libraryNow = lib;
      runtime = new Runtime({ container: el, time: () => 0, onFrame: () => {}, onCompiled: () => {},
        onFrameErrors: () => {}, onStatus: (state, detail) => {
          if (state === 'ready') sentRev = -1;      // a fresh sandbox: the look again at the next state
          if (state === 'dead') link.error.value = detail || 'The pattern engine stopped.';
        } });
      runtime.start(rig, lib.filter((e) => (e.kind || 'source') === 'source').map(({ name, code }) => ({ name, code })));
      return { runtime, count: rig.count, fps: rig.output?.fps || 40 };
    },
    word(s: PiState, base) {
      const l = s.look;
      // A bake, or a source not here yet: nothing to render; the engine plays its own.
      if (!l || !source || source.rev !== l.rev || source.baked || !s.relay || !rigNow) return null;
      if (sentRev !== l.rev) {
        sentRev = l.rev;
        runtime?.setLook(normaliseLayers(piLayers(source, libraryNow), rigNow), piExtra(source));
      }
      return { on: true, rev: l.rev, next: s.relay.next, frame: Math.round(l.t * base.fps), duration: l.duration,
        set: relaySet(l), ...base };
    },
    message(m) { if (m.type === 'source' && m.source) source = m.source; },
    end(r) { r.destroy(); runtime = null; source = null; sentRev = -1; },
    reset() { sentRev = -1; },
  });
  return link;
}
