// What a round says of itself, for "How it was made" (SPEC-generators "The idea log"): the model's thinking summary
// from its calls, its critique, plan and whys from its answer, what changed in the look and what the checks found.
// All of it is the model's or the box's data, bounded here; none of it runs.

import type { HowChange, HowChecks, HowRound } from '../../shared/schemas/api.ts';
import type { Catalog } from './catalog.ts';
import type { Seen } from './check.ts';
import { type Composition, decompose, diffCompositions } from './refine.ts';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const said = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
export const THINKING_MAX = 6000;
const EMPTY: Composition = { title: '', summary: '', layers: [] };

/** A call's thinking summary: Claude's `thinking` blocks, Codex's `reasoning` items; '' when it gave none. */
export function thinkingOf(c: { reply?: unknown, tools?: unknown[] }) {
  const blocks = Array.isArray(c.reply) ? c.reply : isObj(c.reply) && Array.isArray(c.reply.content)
    ? c.reply.content : [];
  const claude = blocks.filter((b) => isObj(b) && b.type === 'thinking').map((b) => (b as Obj).thinking);
  const codex = (c.tools ?? []).filter((t) => isObj(t) && t.type === 'reasoning').map((t) => (t as Obj).text);
  return [...claude, ...codex].filter((t): t is string => typeof t === 'string' && !!t.trim()).join('\n\n');
}

/** The answer's own words: its critique and plan, each a few hundred characters at most. */
export function explainOf(raw: unknown) {
  const a = isObj(raw) ? raw : {}, critique = said(a.critique, 600), plan = said(a.plan, 600);
  return { ...(critique ? { critique } : {}), ...(plan ? { plan } : {}) };
}

/** Each why the answer gives, by what a change line names first: a layer's title, `palette`, `duration`. */
function whys(raw: unknown) {
  const out = new Map<string, string>(), a = isObj(raw) ? raw : {};
  const comp = isObj(a.rewrite) ? a.rewrite : a;
  for (const l of Array.isArray(comp.layers) ? comp.layers : []) {
    const why = isObj(l) && said(l.why, 300);
    if (why && typeof l.title === 'string') out.set(l.title, why);
  }
  for (const e of Array.isArray(a.edits) ? a.edits : []) {
    const why = isObj(e) && said(e.why, 300);
    if (!why) continue;
    const segs = String(e.path ?? '').split('/').filter(Boolean);
    const layer = isObj(e.layer) && typeof e.layer.title === 'string' ? e.layer.title : undefined;
    const subject = segs[0] === 'layers' ? segs[1] : segs[0] === 'globals' ? segs[1] : segs[0] ?? layer;
    if (subject && !out.has(subject)) out.set(subject, why);
  }
  return out;
}
/** A change line's subject: its layer (a preset's layers are numbered after its title), else its first word. */
const subjectOf = (line: string) => line.replace(/^[+−] layer /, '').split(/: | \(/)[0]!.trim();

/** What changed from `before` (none: the first look) to `after`, both expanded looks, each line with the answer's why
 * for it; none when a look cannot be read as a composition. */
export function changesOf(before: Obj | null, after: Obj, raw: unknown, catalog: Catalog): HowChange[] {
  try {
    const lines = diffCompositions(before ? decompose(before, catalog) : EMPTY, decompose(after, catalog));
    const by = whys(raw);
    return lines.map((text) => {
      const s = subjectOf(text), why = by.get(s) ?? by.get(s.replace(/ \d+$/, ''));
      return why ? { text, why } : { text };
    });
  } catch {
    return [];
  }
}

/** What the render check found, as numbers. */
export function checksOf(seen: Seen | null | undefined): HowChecks | undefined {
  if (!seen) return undefined;
  const a = seen.analysis, r = (v: number) => Math.round(v * 1000) / 1000;
  return { ms: Math.round(seen.ms), errors: seen.errors.length,
    ...(a ? { meanBrightness: r(a.meanBrightness), darkFraction: r(a.darkFraction), flashHz: r(a.flicker.maxHz),
      flashOk: a.flicker.ok } : {}) };
}

export const HOW_BYTES = 5000;
type Logged = Record<string, unknown>;
/** An idea's rounds as the idea keeps them, within about HOW_BYTES (no stills, no prompt): each round's head, plan,
 * critique, changes and checks, then its thinking, cut from the oldest round first until it fits. */
export function howOf(rounds: Logged[]): HowRound[] {
  const pick = (r: Logged, thinking: number): HowRound => {
    const t = said(r.thinking, thinking), changes = Array.isArray(r.changes) ? r.changes.slice(0, 12) : undefined;
    return { n: Number(r.n), kind: String(r.kind), ms: Number(r.ms),
      ...(r.outcome ? { outcome: String(r.outcome).slice(0, 120) } : {}),
      ...(isObj(r.tokens) ? { tokens: r.tokens as HowRound['tokens'] } : {}), ...explainOf(r),
      ...(t ? { thinking: t } : {}), ...(changes?.length ? { changes: changes as HowChange[] } : {}),
      ...(isObj(r.checks) ? { checks: r.checks as HowChecks } : {}),
      ...(Array.isArray(r.stills) ? { stills: r.stills.length } : {}) };
  };
  const size = (x: unknown) => Buffer.byteLength(JSON.stringify(x));
  let out = rounds.map((r) => pick(r, 600));
  for (let i = 0; i < out.length && size(out) > HOW_BYTES; i++) out[i] = pick(rounds[i]!, 0);
  while (out.length > 1 && size(out) > HOW_BYTES) out = out.slice(1);
  return out;
}
