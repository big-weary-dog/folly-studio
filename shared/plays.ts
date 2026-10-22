// What plays: kept apart from the look's schemas (look.ts re-exports it) so the browser takes it without zod.

/** pattern-core's DEFAULT_DURATION (test/plays.test.ts): importing the core would put it in the app's first load. */
const DEFAULT_DURATION = 30;

/**
 * What plays (SPEC-history "What plays"): the fields a bake renders, a version keeps, the stage plays, an export
 * carries and an undo puts back. Everything that asks "did what plays change" or "what played then" reads this
 * list. The title and the summary are the look's words, not what plays.
 */
export const PLAYS = ['layers', 'duration', 'globals', 'automation', 'bpm'] as const;
export type PlaysKey = typeof PLAYS[number];
/** What plays beside the layers and the length: what the sandbox and the render box take with the layers. */
export const EXTRAS = PLAYS.filter((k): k is ExtraKey => k !== 'layers' && k !== 'duration');
export type ExtraKey = Exclude<PlaysKey, 'layers' | 'duration'>;
type Playing = { [K in PlaysKey]?: unknown };
/** A look's PLAYS: the layers and the length always (defaults: none, 30 s), the extras when set (not null). */
type PlaysOf<T extends Playing> = { layers: NonNullable<T['layers']>, duration: number }
  & { [K in ExtraKey]?: NonNullable<T[K]> };

export function playsOf<T extends Playing>(look: T): PlaysOf<T> {
  const out: Record<string, unknown> = { layers: look.layers ?? [], duration: look.duration ?? DEFAULT_DURATION };
  for (const k of EXTRAS) if (look[k] != null) out[k] = look[k];
  return out as PlaysOf<T>;
}

/** A look's extras (EXTRAS) when set. */
export const extrasOf = <T extends Playing>(look: T) => Object.fromEntries(EXTRAS.filter((k) => look[k] != null)
  .map((k) => [k, look[k]])) as { [K in ExtraKey]?: NonNullable<T[K]> };

/** JSON with every object's keys sorted: the same text for the same content, whatever order its keys came in. */
export const canonical = (v: unknown): string => JSON.stringify(v, (_, x) => (x && typeof x === 'object'
  && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x)) ?? 'null';

/** Does what plays differ? Unchanged fields are often the same object, so those cost nothing. */
export function playsChanged(a: Playing, b: Playing) {
  const [x, y] = [playsOf(a), playsOf(b)] as Record<string, unknown>[];
  return PLAYS.some((k) => x[k] !== y[k] && canonical(x[k]) !== canonical(y[k]));
}
