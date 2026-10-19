// Colour picks (SPEC "Palettes"): which palette colours a colour param plays. A pick is tokens: a role (`body`: its
// colours), a slot (`body2`: one), `all` (the palette low to high), `rainbow` or '#rrggbb'; spaces join them in order,
// `/` deals them in turn (`body/accent`: body1 accent1 body2 …). With `blend` (step by default: equal bands; smooth: a
// ramp), `range` (a stretch of the walk) and `rotate` (a shift along the stops, wrapping). Picks resolve to stops when
// a module is bound and again when the palette changes; per pixel, pal() and swatch() walk them. A bare role in pal()
// (code from before one colour param per source) reads the look palette's role.
import type { ParamSchema } from './compile.ts';
import type { Values } from './globals.ts';
import { clamp, hex, isNum, PALETTE_ROLES, ramp, RUN, STDLIB } from './stdlib.ts';
import type { PaletteColours, PaletteRole, RGB } from './stdlib.ts';

export type PickBlend = 'smooth' | 'step';
/** A token: a role, a slot, all, rainbow or '#rrggbb'; or an [r, g, b] given as a param's value. */
type Token = string | readonly number[];
type Stops = readonly (readonly number[])[];
type Range = readonly [number, number];
/** A pick as given: token groups (dealt in turn when more than one), blend, range and rotate (0 when bound). */
export type PickSpec = { groups: Token[][], blend: PickBlend | null, range: Range | null, rotate: number };

const PICK_TOKEN = /^(?:(?:low|body|accent|high)(?:[1-9]|1[0-6])?|all|rainbow|#[0-9a-f]{6}|#[0-9a-f]{3})$/;
const PICK_SLOT = /^(low|body|accent|high)(\d+)$/;
const MAX_TOKENS = 64, MAX_STOPS = 256;
// Seven hsv stops round the wheel, red to red: hsv is piecewise linear between them, so the smooth ramp is exact;
// step takes the first six, so red is one band.
const RAINBOW: Stops = Object.freeze([0, 1, 2, 3, 4, 5, 6].map((k) => Object.freeze(STDLIB.hsv(k / 6))));

/** A param's value as a pick: a string of tokens, { pick, blend?, range?, rotate? }, '#hex' or
 * [r, g, b]. Unknown tokens are ignored; null when nothing is left. */
export function readPick(v: unknown): PickSpec | null {
  if (Array.isArray(v)) {
    return v.length >= 3 ? { groups: [[[+v[0] || 0, +v[1] || 0, +v[2] || 0]]], blend: null, range: null, rotate: 0 }
      : null;
  }
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : null, text = o ? o.pick : v;
  if (typeof text !== 'string') return null;
  const groups: Token[][] = [];
  let count = 0;
  for (const part of text.slice(0, 400).toLowerCase().split('/')) {
    const g = part.split(/[\s,]+/).filter((w) => PICK_TOKEN.test(w) && count++ < MAX_TOKENS)
      .map((w) => (w.length === 4 && w[0] === '#' ? `#${w[1]}${w[1]}${w[2]}${w[2]}${w[3]}${w[3]}` : w));
    if (g.length) groups.push(g);
  }
  const bare = /^\s*#?([0-9a-f]{3}|[0-9a-f]{6})\s*$/i.exec(text);   // 'ff8000', as hex() reads it
  if (!groups.length && bare) groups.push([`#${bare[1].length === 3 ? bare[1].replace(/./g, '$&$&') : bare[1]}`]);
  if (!groups.length) return null;
  const r = o?.range;
  return { groups, blend: o?.blend === 'smooth' || o?.blend === 'step' ? o.blend : null,
    range: Array.isArray(r) && r.length === 2 && isNum(r[0]) && isNum(r[1]) ? [clamp(r[0]), clamp(r[1])] : null,
    rotate: o && isNum(o.rotate) ? o.rotate : 0 };
}

const hexOfRgb = (c: readonly number[]) => `#${c.slice(0, 3).map((v) => Math.round(clamp(Number(v) || 0) * 255)
  .toString(16).padStart(2, '0')).join('')}`;
/** A pick's tokens as text: 'body/accent', 'low2 #ff8000'. */
export const pickText = (groups: readonly (readonly Token[])[]) => groups.map((g) => g
  .map((t) => (typeof t === 'string' ? t : hexOfRgb(t))).join(' ')).join('/');

/** What a role's tokens expand to and what pal(role) walks; `fallback` stands in for an empty role. */
export type Roles = { palette: PaletteColours, lists: Readonly<Record<PaletteRole, Stops>>,
  table: Readonly<Record<string, Slot>>, fallback: Slot };

/** A token's colours: a role, a slot (a missing one: nothing), all, rainbow, a literal. */
function expandToken(t: Token, R: Roles, step: boolean, out: (readonly number[])[]) {
  if (typeof t !== 'string') out.push(t);
  else if (t[0] === '#') out.push(Object.freeze(hex(t)));
  else if (t === 'all') out.push(...R.palette.all);
  else if (t === 'rainbow') out.push(...(step ? RAINBOW.slice(0, 6) : RAINBOW));
  else {
    const m = PICK_SLOT.exec(t);
    if (!m) out.push(...R.lists[t as PaletteRole]);
    else if (R.palette[m[1] as PaletteRole][+m[2] - 1]) out.push(R.palette[m[1] as PaletteRole][+m[2] - 1]);
  }
}

/** A pick's stops: each group's tokens in order (a group of missing slots: their roles), groups dealt in turn, the
 * shorter ones wrapping; nothing at all: the fallback. */
export function pickStops(groups: readonly (readonly Token[])[], R: Roles, step: boolean): Stops {
  const lists = [];
  for (const g of groups) {
    const out: (readonly number[])[] = [];
    for (const t of g) expandToken(t, R, step, out);
    const slots = out.length ? [] : g.filter((t): t is string => typeof t === 'string' && PICK_SLOT.test(t));
    for (const t of slots) expandToken(t.replace(/\d+$/, ''), R, step, out);
    if (out.length) lists.push(out);
  }
  if (!lists.length) return R.fallback.stops;
  if (lists.length === 1) return lists[0].slice(0, MAX_STOPS);
  const out = [], long = Math.max(...lists.map((l) => l.length));
  for (let i = 0; i < long && out.length < MAX_STOPS; i++) for (const l of lists) out.push(l[i % l.length]);
  return out;
}

/** A pick resolved: its stops, blend and range, and what its rotate makes of them (turnSlot). */
export type Slot = { stops: Stops, step: boolean, lo: number, span: number, turn: number, shift: number, k: number,
  w: number, plain: boolean };
function newSlot(stops: Stops, step: boolean, range: Range | null, rotate: number): Slot {
  const s = { stops, step, lo: range ? range[0] : 0, span: range ? range[1] - range[0] : 1, turn: NaN, shift: 0,
    k: 0, w: 0, plain: false };
  turnSlot(s, rotate);
  return s;
}

/** Rotate r (turns, wrapping): a smooth walk shifts along the stops, the wrap included; step holds each stop and
 * crossfades to the next over the last fifth of it, so a turning pick never cuts. `plain`: exactly the old ramp. */
export function turnSlot(s: Slot, r: number) {
  const f = r - Math.floor(r), x = (f >= 0 ? f : 0) * s.stops.length, k = Math.floor(x), e = (x - k - 0.8) / 0.2;
  s.turn = r; s.shift = x; s.k = k; s.w = e > 0 ? e * e * (3 - 2 * e) : 0;
  s.plain = !s.step && x === 0 && s.lo === 0 && s.span === 1;
}

function mixInto(L: Stops, i: number, w: number, out: number[]) {
  const n = L.length, a = L[i % n];
  if (w > 0) {
    const b = L[(i + 1) % n];
    out[0] = a[0] + (b[0] - a[0]) * w; out[1] = a[1] + (b[1] - a[1]) * w; out[2] = a[2] + (b[2] - a[2]) * w;
  } else {
    out[0] = a[0]; out[1] = a[1]; out[2] = a[2];
  }
  return out;
}

/** The colour at t (0..1, clamped) along a slot: equal bands (step) or a ramp (smooth), range and rotate applied. */
export function walkSlot(s: Slot, t: number, out: number[]) {
  const n = s.stops.length, u = s.lo + s.span * (t > 0 ? (t < 1 ? t : 1) : 0);
  if (s.step) {
    const i = Math.floor(u * n);
    return mixInto(s.stops, (i < n ? i : n - 1) + s.k, s.w, out);
  }
  const x = u * (n - 1) + s.shift, i = Math.floor(x);
  return mixInto(s.stops, i, x - i, out);
}

/** The i-th stop (floored, wrapping), rotate applied. */
function slotSwatch(s: Slot, i: number, out: number[]) {
  const n = s.stops.length;
  let j = Math.floor(i);
  if (j - j !== 0) j = 0;                    // NaN, ±Infinity
  return mixInto(s.stops, ((j + s.k) % n + n) % n, s.w, out);
}

/** The palette's roles: each a smooth ramp, as pal(role, t) always walked. */
function buildRoles(palette: PaletteColours): Roles {
  const lists = {} as Record<PaletteRole, Stops>, table: Record<string, Slot> = Object.create(null);
  for (const role of PALETTE_ROLES) {
    lists[role] = palette[role];
    if (lists[role].length) table[role] = newSlot(lists[role], false, null, 0);
  }
  const fallback = table.body ?? newSlot(palette.all, false, null, 0);
  for (const role of PALETTE_ROLES) table[role] ??= fallback;
  return { palette, lists, table, fallback };
}

let PLAIN: Roles | null = null;
/** The palette's roles (made once per palette). */
export function plainRoles(palette: PaletteColours) {
  if (PLAIN?.palette !== palette) PLAIN = buildRoles(palette);
  return PLAIN;
}
const current = () => plainRoles(RUN.palette);

/** The colours a pick (a param's value or default) plays against `R`: what the UI's strip shows. */
export function stopsFor(v: unknown, dflt: unknown, R: Roles, blend?: PickBlend) {
  const spec = readPick(v) || readPick(dflt);
  return spec ? pickStops(spec.groups, R, (spec.blend || blend || 'step') === 'step') : R.fallback.stops;
}

const WHITE: PickSpec = { groups: [['#ffffff']], blend: null, range: null, rotate: 0 };
type ColourSpec = { value: unknown, blend?: PickBlend };
/** A colour param's value (or its default) as one colour, now: P before its module is bound. */
export function pickColour(d: ColourSpec, v: unknown): RGB {
  const spec = readPick(v) || readPick(d.value) || WHITE, step = (spec.blend || d.blend || 'step') === 'step';
  const s = newSlot(pickStops(spec.groups, current(), step), step, spec.range, spec.rotate);
  return walkSlot(s, 0, [0, 0, 0]) as RGB;
}

type Own = { key: string, groups: Token[][], slot: Slot, rgb: number[] };
/** A module instance's colours: pal() and swatch() bound to its slots (its colour params, then the palette's roles),
 * its rotates (`rot`, which bound rotates move), and P's colours kept current (frame()). */
export function newPicks() {
  let basis: Roles | null = null, table: Record<string, Slot> = Object.create(null);
  const own: Own[] = [], rot: Values = {};
  function refresh(R: Roles) {
    basis = R;
    table = Object.assign(Object.create(null), R.table);
    for (const o of own) {
      o.slot.stops = pickStops(o.groups, R, o.slot.step);
      turnSlot(o.slot, rot[o.key] as number);
      table[o.key] = o.slot;
      walkSlot(o.slot, 0, o.rgb);
    }
  }
  const slot = (name: string) => {
    const R = current();
    if (basis !== R) refresh(R);
    return table[name] || R.fallback;
  };
  const self = {
    rot,
    /** pal(name, t): t 0..1 along a colour param's pick, else a role of the palette, else body. */
    pal(name: string, t = 0): RGB {
      const s = slot(name);
      return (s.plain ? ramp(s.stops, t) : walkSlot(s, t, [0, 0, 0])) as RGB;
    },
    /** swatch(name, i): the i-th colour of a colour param's pick or a role (floored, wrapping). */
    swatch: (name: string, i = 0) => slotSwatch(slot(name), i, [0, 0, 0]) as RGB,
    /** Bind to a schema's colour params and these overrides; P's colours are kept in place. */
    bind(schema: ParamSchema | undefined, overrides: unknown, P: Values) {
      own.length = 0;
      const o = (overrides && typeof overrides === 'object' ? overrides : {}) as Record<string, unknown>;
      for (const [key, d] of Object.entries(schema || {})) {
        if (d.type !== 'color') continue;
        const mine = Object.hasOwn(o, key) ? readPick(o[key]) : null, spec = mine || readPick(d.value) || WHITE;
        const step = (mine?.blend || d.blend || 'step') === 'step';
        rot[key] = mine ? mine.rotate : 0;
        own.push({ key, groups: spec.groups, slot: newSlot([], step, mine?.range ?? null, 0),
          rgb: Array.isArray(P[key]) ? P[key] as number[] : (P[key] = [0, 0, 0]) as number[] });
      }
      basis = null;
      self.frame();
    },
    /** Once a frame, before the module runs: P's colours for a new palette or a moved rotate. No allocation. */
    frame() {
      const R = current();
      if (basis !== R) return refresh(R);
      for (const o of own) {
        const r = rot[o.key] as number;
        if (r !== o.slot.turn) { turnSlot(o.slot, r); walkSlot(o.slot, 0, o.rgb); }
      }
    },
  };
  return self;
}
export type Picks = ReturnType<typeof newPicks>;
