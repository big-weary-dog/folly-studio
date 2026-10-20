// Pictures (SPEC-library "Pictures"): a picture param's value, text rows and a key, as pure data. readPicture holds
// one to the limits or refuses it; the pattern reads it from P as given, so every engine passes it through untouched.

export type Picture = Readonly<{ grid: 'rose' | 'square', repeat: number, key: Readonly<Record<string, string>>,
  frames: readonly Readonly<{ rows: readonly string[], hold: number }>[] }>;

export const PICTURE_LIMITS = Object.freeze({ rows: 128, columns: 128, frames: 16, keys: 16, hold: 64, repeat: 16,
  bytes: 32768 });
// A key's colour: a role or slot of the palette, or '#rrggbb', and a brightness ('body2 40%').
export const PICTURE_COLOUR = /^(?:(?:low|body|accent|high)(?:[1-9]|1[0-6])?|#[0-9a-f]{6})(?: (?:100|[1-9]?\d)%)?$/i;
const CHAR = /^[!-~]$/;   // one printable ASCII character; '.' and space are always clear
const CLEAR = '. ';

export const EMPTY_PICTURE: Picture = Object.freeze({ grid: 'rose', repeat: 1, key: Object.freeze({}),
  frames: Object.freeze([Object.freeze({ rows: Object.freeze([]), hold: 1 })]) });

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown, lo: number, hi: number, d: number) => (v === undefined ? d
  : Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? v as number : NaN);

/** Why `v` is not a picture, or '' when it is one. */
export function pictureProblem(v: unknown): string {
  const L = PICTURE_LIMITS;
  if (!obj(v)) return 'a picture is { grid, repeat?, key, frames }.';
  let size = Infinity;
  try { size = JSON.stringify(v).length; } catch { /* not plain data */ }
  if (!(size <= L.bytes)) return `a picture is plain data, at most ${L.bytes} characters.`;
  if (v.grid !== 'rose' && v.grid !== 'square') return 'grid is rose or square.';
  if (Number.isNaN(whole(v.repeat, 1, L.repeat, 1))) return `repeat is a whole number from 1 to ${L.repeat}.`;
  const keys = obj(v.key) ? Object.entries(v.key) : [];
  if (!obj(v.key) || keys.length > L.keys) return `key is up to ${L.keys} character → colour.`;
  for (const [ch, c] of keys) {
    if (!CHAR.test(ch) || CLEAR.includes(ch)) return `key "${ch.slice(0, 4)}" is not one character (or is . clear).`;
    if (typeof c !== 'string' || !PICTURE_COLOUR.test(c.trim())) {
      return `key ${ch}: ${String(c).slice(0, 20)} is not a palette colour (body, accent2) or #rrggbb, with N%.`;
    }
  }
  if (!Array.isArray(v.frames) || !v.frames.length || v.frames.length > L.frames) {
    return `frames is a list of 1 to ${L.frames}.`;
  }
  for (const [i, f] of v.frames.entries()) {
    const at = `frame ${i + 1}:`;
    if (!obj(f) || !Array.isArray(f.rows) || f.rows.length > L.rows) return `${at} rows, at most ${L.rows}.`;
    if (Number.isNaN(whole(f.hold, 1, L.hold, 1))) return `${at} hold is a whole number from 1 to ${L.hold}.`;
    for (const r of f.rows) {
      if (typeof r !== 'string' || r.length > L.columns) return `${at} a row is text of at most ${L.columns}.`;
      const stray = [...r].find((ch) => !CLEAR.includes(ch) && !Object.hasOwn(v.key as object, ch));
      if (stray) return `${at} "${stray}" is not in the key.`;
    }
  }
  return '';
}

/** `v` as a frozen, normalised picture, or null when it is not one (pictureProblem says why). */
export function readPicture(v: unknown): Picture | null {
  if (pictureProblem(v)) return null;
  const p = v as Record<string, unknown> & { key: Record<string, string>, frames: Record<string, unknown>[] };
  return Object.freeze({ grid: p.grid as Picture['grid'], repeat: whole(p.repeat, 1, 16, 1),
    key: Object.freeze(Object.fromEntries(Object.entries(p.key).map(([k, c]) => [k, c.trim()]))),
    frames: Object.freeze(p.frames.map((f) => Object.freeze({ rows: Object.freeze([...f.rows as string[]]),
      hold: whole(f.hold, 1, 64, 1) }))) });
}
