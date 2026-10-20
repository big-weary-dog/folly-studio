// Following /pi's engine on a viewer (SPEC-live "Following /pi"): its look with each module's code from our library by
// ref, the values, tempo and clock it set on it, to set in place as it does (so clocks bound to them run on as its
// do), and its show time on the server's clock, anchored once and moved only when the engine's differs by more than
// 100 ms, so frames never step back.
import type { PiNow, PiSource } from '../../../../shared/schemas/live.ts';
import type { LiveSet } from '../../live-set.ts';
import type { Extra } from '../../runtime.ts';

const SLIP_S = 0.1;
export type Pi = { at: number, now: PiNow | null, source: PiSource | null };
type Entry = { name: string, kind?: string, code: string };

/** The source's layers, each module's code (and kind) the library's entry by its ref. */
export function piLayers(source: PiSource, library: readonly Entry[]) {
  const byName = new Map(library.map((e) => [e.name, e]));
  return source.layers.map((l) => ({ ...l, modules: ('modules' in l ? l.modules : []).map((m) => {
    const e = m.ref ? byName.get(m.ref) : undefined;
    return { ...m, kind: (e?.kind ?? m.kind) as typeof m.kind, code: e?.code ?? '' };
  }) }));
}

/** The look's own globals, automation and tempo, on a fresh clock: what plays now is set in place (piSet). */
export const piExtra = (source: PiSource): Extra => ({ globals: source.globals, automation: source.automation,
  bpm: source.bpm, clock: 'fresh' });

/** What the engine has set on its look now, for the sandbox to set in place before a frame. */
export const piSet = (now: PiNow): LiveSet => ({ values: now.values, bpm: now.bpm, beat0: now.beat0,
  offset: now.offset, paces: now.paces });

/** The show-time anchor: the server's epoch ms of show time 0 in the loop, kept per source rev. */
export function piClock() {
  let rev = -1, zero = 0;
  return {
    /** A new reading of the engine: re-anchored if its look changed or it slipped. */
    see(pi: Pi) {
      const n = pi.now;
      if (!n) return;
      const z = pi.at - n.t * 1000, d = pi.source?.duration || 30;
      const slip = Math.abs((((z - zero) / 1000 % d) + d * 1.5) % d - d / 2);
      if (n.rev !== rev || slip > SLIP_S) { rev = n.rev; zero = z; }
    },
    /** Show time in the loop at server time `serverNow`. */
    t(serverNow: number, duration: number) {
      const tau = Math.max(0, (serverNow - zero) / 1000);
      return tau - Math.floor(tau / duration) * duration;
    },
  };
}
