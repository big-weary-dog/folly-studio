// Relay to the lights (SPEC-live "Relay to the lights"): one sender at a time holds the lease and sends the look's rgb
// as binary frames, rendered ahead in its browser, each for a slot of the engine's timer; the engine plays them in
// place of its own render. Frames wait in a ring keyed by slot. A slot with no frame holds the last one for up to
// HOLD slots, then dips through black to the engine's own render; relayed frames come back on the first after a
// start or a switch, else after a second of steady ones. An `over` lease (Studio's editor) plays over whatever look
// the engine has, any rev; the guard tripping on it ends it. A frame is data: its length checked, its values Uint16.

export const RELAY = { slots: 128, hold: 4, dipSecs: 0.1, leaseMs: 1000, header: 8 };
export type RelayState = { by: string, over: boolean, on: boolean, index: number, next: number, ahead: number,
  misses: number, frames: number };

export function createRelay({ count, fps, now = () => performance.now() }: { count: number, fps: number,
  now?: () => number }) {
  const size = count * 3, bytes = RELAY.header + size * 2, period = 1000 / fps;
  const slots = Array.from({ length: RELAY.slots }, () => ({ index: -1, rev: -1, rgb: new Uint16Array(size) }));
  // The holder (a socket, as the server has it) and its name; whether relayed frames play; the dip's gain.
  let holder: object | null = null, by = '', over = false, on = false, picked = false, dip = 1, dipTo = 1;
  let played = -1, playedAt = 0, gotAt = -Infinity, lastRev = -1, steady = 0, lastIn = 0;
  let misses = 0, frames = 0, tokens = RELAY.slots, tokensAt = now();
  let onEnd: (holder: object, why: string) => void = () => {};

  function end(why: string) {
    const h = holder;
    holder = null;
    picked = false;
    for (const s of slots) s.index = -1;
    if (h) onEnd(h, why);
  }

  return {
    bytes,
    /** Told when a lease ends on its own (no frames for a second). */
    onEnd(f: typeof onEnd) { onEnd = f; },
    /** The lease for `who`, named `name`, `over` whatever look plays; '' when it has it, else why not. */
    start(who: object, name: string, overAny = false) {
      if (holder && holder !== who) return `${by} is relaying to the lights.`;
      if (holder !== who) { misses = 0; frames = 0; }
      holder = who;
      by = name;
      over = overAny;
      picked = true;
      lastIn = now();
      return '';
    },
    /** The lease let go, if `who` holds it. */
    stop(who: object) { if (holder === who) end(''); },
    /** The flash guard tripped: an `over` lease ends (the engine's switch to safe would not stop its frames). */
    tripped() { if (holder && over) end('The flash guard tripped: the lights play their own.'); },
    holds: (who: object) => holder === who,
    /** A frame from `who`: '' when taken (or dropped as out of its window), else why it was refused. */
    push(who: object, data: Uint8Array) {
      if (holder !== who) return 'Not relaying: send relay-start first.';
      if (data.length !== bytes) return `A frame is ${bytes} bytes.`;
      const t = now();
      tokens = Math.min(RELAY.slots, tokens + (t - tokensAt) * 4 * fps / 1000);
      tokensAt = t;
      if (tokens < 1) return '';
      tokens--;
      lastIn = t;
      const view = new DataView(data.buffer, data.byteOffset, data.length);
      const index = view.getUint32(0, true), rev = view.getUint32(4, true);
      if (index <= played || index - played >= RELAY.slots) return '';
      const s = slots[index % RELAY.slots]!;
      s.index = index;
      s.rev = rev;
      new Uint8Array(s.rgb.buffer).set(data.subarray(RELAY.header));
      return '';
    },
    /** Slot `slot` of the engine's look `rev`: true when `rgb` is the relay's (a frame, or the last one held). */
    fill(slot: number, rev: number, rgb: Float32Array, dt: number) {
      played = slot;
      playedAt = now();
      if (holder && playedAt - lastIn > RELAY.leaseMs) end('No frames for a second: the lights play their own.');
      const s = slots[slot % RELAY.slots]!, got = !!holder && s.index === slot && (over || s.rev === rev);
      if (rev !== lastRev) {
        // A switch: the new look starts on the engine's own render (it fades in from black), never the old frame.
        lastRev = rev;
        if (on && !over) { on = false; dip = dipTo = 1; picked = true; }
      }
      if (got) { steady++; gotAt = slot; } else { steady = 0; if (holder) misses++; }
      if (!on && got && (picked || steady >= fps)) { on = true; picked = false; dip = dipTo = 1; }
      if (on && !got && slot - gotAt > RELAY.hold) dipTo = 0;
      const step = dt / RELAY.dipSecs;
      dip = Math.abs(dipTo - dip) <= step ? dipTo : dip + Math.sign(dipTo - dip) * step;
      if (on && dip === 0 && dipTo === 0) { on = false; dipTo = 1; }
      if (!on || !got) return on;
      frames++;
      for (let i = 0; i < size; i++) rgb[i] = s.rgb[i]! / 65535;
      return true;
    },
    /** The dip's gain, a factor on the output's. */
    gain: () => dip,
    state(): RelayState | null {
      if (!holder) return null;
      let ahead = 0;
      while (ahead < RELAY.slots - 1 && slots[(played + 1 + ahead) % RELAY.slots]!.index === played + 1 + ahead) {
        ahead++;
      }
      return { by, over, on, index: played + Math.min(1, (now() - playedAt) / period), next: played + 1, ahead, misses,
        frames };
    },
  };
}
export type Relay = ReturnType<typeof createRelay>;
