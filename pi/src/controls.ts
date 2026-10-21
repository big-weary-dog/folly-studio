// A look's live controls on the Pi: the macros it offers (globals.live, else its faders) and its tempo, set in place
// on the prepared look (SPEC "Globals"), each eased to its target over SLEW seconds so a push never steps. bpm keeps
// the beat's phase; a name the look automates is released from its lane at the first push. Tap tempo sets bpm and the
// downbeat together.
import { prepareLook, type PreparedLook } from '../../public/js/pattern-core.ts';
import type { PiLook } from './library.ts';

export const SLEW = 0.05;            // seconds a control takes to reach a pushed value
export const BPM = { min: 40, max: 240 };
const TAP_GAP_MS = 2000, TAPS = 8;

export type Control = { name: string, min: number, max: number, value: number, kind: 'macro' | 'bpm' };

/** The controls a look offers, in its order, with their current values on `L`. */
export function controlsOf(look: PiLook, L: PreparedLook): Control[] {
  const macros = L.g.macros, live = look.globals?.live ?? macros.filter((m) => !m.mod).map((m) => m.name);
  const out: Control[] = [];
  for (const name of live) {
    if (name === 'bpm') out.push({ name, ...BPM, value: L.bpm, kind: 'bpm' });
    else {
      const m = macros.find((x) => x.name === name);
      if (m) out.push({ name, min: m.min, max: m.max, value: m.value, kind: 'macro' });
    }
  }
  return out;
}

/** The live side of a playing look: set(name, v) a target, step(t, dt) eases toward them, tap(t, ms) the tempo. */
export function liveLook(look: PiLook, previous?: PreparedLook) {
  let L = prepareLook(look, previous);
  let automation = { ...look.automation };
  const controls = controlsOf(look, L), targets = new Map<string, number>();
  const byName = new Map(controls.map((c) => [c.name, c]));
  let taps: number[] = [];

  const read = (c: Control) => (c.kind === 'bpm' ? L.bpm : L.g.macros.find((m) => m.name === c.name)!.value);

  /** Writes v to the look for show time t, the frame about to render: the beat and paces go on from there. */
  function write(c: Control, v: number, at: number) {
    if (c.kind === 'bpm') {
      const phase = (at - L.beat0) * L.bpm / 60;
      L.bpm = v;
      L.beat0 = at - phase * 60 / v;
    } else {
      const m = L.g.macros.find((x) => x.name === c.name)!;
      L.repace(c.name, m.value, v, at);
      m.value = v;
    }
    c.value = v;
  }

  /** A pushed name the look automates or modulates leaves its lane or its mod, starting from its value now; what
   * it paces goes on unbroken. */
  function release(name: string, t: number) {
    const moved = L.g.macros.find((m) => m.name === name)?.mod;
    if (!(name in automation) && !moved) return;
    const now = L.normAt(name, t), c = byName.get(name)!, value = c.min + now * (c.max - c.min);
    const { [name]: _, ...rest } = automation;
    automation = rest;
    const macros = Object.fromEntries(L.g.macros.map((m) => [m.name, { value: m.value, min: m.min, max: m.max,
      ...m.mod && m.name !== name ? { mod: m.mod } : {} }]));
    const next = prepareLook({ ...look, globals: { ...look.globals, macros }, automation }, L);
    Object.assign(next, { bpm: L.bpm, beat0: L.beat0 });
    for (const n of Object.keys(macros)) {
      next.paceOffset.set(n, (next.paceOffset.get(n) ?? 0) + L.paceAt(n, t) - next.paceAt(n, t));
    }
    L = next;
    write(c, value, t);
  }

  return {
    get look() { return L; },
    /** The look's automation as it plays: a pushed name has left it. */
    get automation() { return automation; },
    controls,
    set(name: string, v: number, t: number) {
      const c = byName.get(name);
      if (!c || !Number.isFinite(v)) return false;
      release(name, t);
      targets.set(name, Math.min(c.max, Math.max(c.min, v)));
      return true;
    },
    /** Each control a step of dt seconds toward its target. */
    step(t: number, dt: number) {
      for (const [name, target] of targets) {
        const c = byName.get(name)!, cur = read(c), most = (c.max - c.min) * dt / SLEW;
        const v = Math.abs(target - cur) <= most ? target : cur + Math.sign(target - cur) * most;
        if (v !== cur) write(c, v, t);
        if (v === target) targets.delete(name);
      }
    },
    /** A tap at show time t (clock ms): the downbeat now, and from 2+ taps in a row the tempo between them. */
    tap(t: number, ms: number) {
      if (taps.length && ms - taps[taps.length - 1]! > TAP_GAP_MS) taps = [];
      taps.push(ms);
      if (taps.length > TAPS) taps.shift();
      if (taps.length >= 2) {
        const bpm = 60000 * (taps.length - 1) / (taps[taps.length - 1]! - taps[0]!);
        L.bpm = Math.round(Math.min(BPM.max, Math.max(BPM.min, bpm)) * 10) / 10;
        targets.delete('bpm');
        const c = byName.get('bpm');
        if (c) c.value = L.bpm;
      }
      L.beat0 = t;
      return L.bpm;
    },
    /** Show time wrapped back by `duration`: the beat carries on rather than restarting. */
    wrapped(duration: number) { L.beat0 -= duration; },
    values: () => Object.fromEntries(controls.map((c) => [c.name, read(c)])),
  };
}
export type LiveLook = ReturnType<typeof liveLook>;
