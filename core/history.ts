// The frame buffer (SPEC "History"): a filter that declares `const history = <seconds>` gets the colours of what is
// above it, at each of its LEDs, for that long; past(ago) reads them at any time back, per pixel. Frames are kept on
// a fixed grid of RATE a second (a frame between two renders is their blend), as bytes, so a reading between grid
// times blends the two around it and any render rate plays smoothly. Time going back, or a jump of more than JUMP,
// starts it again; a reading before what it holds gets the oldest frame it has.

export const RATE = 40;            // grid frames a second: the render box's rate
export const HISTORY_MAX = 8;      // seconds a filter may declare
const JUMP = 0.5;                  // seconds: a longer step forward is a seek

/** A module instance's frame buffer: sized when its layer first renders, filled by the core, read by past(). */
export function newHistory() {
  let seconds = 0, cap = 0, m = -1, slots = new Uint8ClampedArray(0), head = new Float32Array(0);
  let last = NaN, now = 0, from = 0, first = 0, fresh = true, prev = 0, j = 0;
  const out = [0, 0, 0, 0];
  const slot = (n: number) => ((n % cap) + cap) % cap * m * 4;
  /** Blend of colours a (bytes or floats, scaled by sa) and b (by sb) at f, by their alpha, into out. */
  const blend = (a: ArrayLike<number>, ao: number, sa: number, b: ArrayLike<number>, bo: number, sb: number,
    f: number) => {
    const aa = a[ao + 3]! * sa * (1 - f), ba = b[bo + 3]! * sb * f, al = aa + ba;
    for (let i = 0; i < 3; i++) {
      const x = a[ao + i]! * sa, y = b[bo + i]! * sb;
      out[i] = al > 0 ? (x * aa + y * ba) / al : x + (y - x) * f;
    }
    out[3] = al;
    return out;
  };
  return {
    /** Declares how many seconds it keeps (0: none). */
    keep(s: number) { seconds = s; },
    get seconds() { return seconds; },
    /** Once a frame, before any pixel: the frame at pattern time T over m LEDs. */
    advance(T: number, n: number) {
      if (n !== m) {
        m = n;
        cap = Math.ceil(seconds * RATE) + 2;
        slots = new Uint8ClampedArray(cap * m * 4);
        head = new Float32Array(m * 4);
        last = NaN;
      }
      const s = Math.floor(T * RATE), d = T - last;
      fresh = !(d >= 0 && d <= JUMP);
      if (fresh) first = s;
      from = Math.max(fresh ? s : now + 1, s - cap + 1);
      prev = last;
      now = s;
      last = T;
    },
    /** Per pixel, before the filter: LED j's colour now, c, kept; past() then reads LED j. */
    record(i: number, c: readonly number[]) {
      const o = 4 * i;
      for (let n = from; n <= now; n++) {
        const at = slot(n) + o, f = fresh ? 1 : (n / RATE - prev) / (last - prev);
        for (let k = 0; k < 4; k++) slots[at + k] = (head[o + k]! + (c[k]! - head[o + k]!) * f) * 255;
      }
      for (let k = 0; k < 4; k++) head[o + k] = c[k]!;
      j = i;
    },
    /** What was above this filter at this LED `ago` seconds back (0 now, up to what it keeps), [r, g, b, a] reused. */
    past(ago = 0) {
      if (!(seconds > 0)) throw new Error('past() needs `const history = <seconds>` at the top of a filter');
      if (m < 0) return out.fill(0);
      const o = 4 * j, lo = Math.max(first, now - cap + 1);
      let x = (last - (ago > 0 ? (ago < seconds ? ago : seconds) : 0)) * RATE;
      if (x < lo) x = lo;
      if (x >= now) {
        const span = last * RATE - now;
        return blend(slots, slot(now) + o, 1 / 255, head, o, 1, span > 0 ? (x - now) / span : 1);
      }
      const n = Math.floor(x);
      return blend(slots, slot(n) + o, 1 / 255, slots, slot(n + 1) + o, 1 / 255, x - n);
    },
  };
}
export type History = ReturnType<typeof newHistory>;
