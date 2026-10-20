// The rounds inside one idea (SPEC-generators "Composition", "The render check", "Critique"): the model's
// composition, expanded; one repair round when it names what the library lacks, and one when expand had to change many
// of its params; the render check, with one more repair round when the look throws in the box; then, when the model
// has it, a critique round on the whole look as it rendered (an exploring idea asks for more, each to change
// something: explore.ts). None of it is another use. A later round's answer is kept only when it expands and renders
// no worse. Each round goes to the idea's log (idea-log.ts) with its calls, outcome, notes and stills.

import { lookDuration, prepareScene } from '../../public/js/pattern-core.ts';
import { validateLook } from '../../shared/schemas/generated.ts';
import type { Catalog } from './catalog.ts';
import { type Box, renderCheck, type Seen } from './check.ts';
import { buildCritiqueMessage, buildNotesMessage, groupWarnings } from './critique-prompt.ts';
import { expand } from './expand.ts';
import { closeUpGroups } from './frames-closeup.ts';
import { viewFrames } from './frames-view.ts';
import { NO_ROUND, type Round } from './idea-log.ts';
import type { Adapter, Context, Repair } from './index.ts';
import type { Logger } from '../http.ts';

type Lane = Parameters<typeof renderCheck>[2]['lane'];
export type Critique = 'images' | 'text';
export type Rounds = Awaited<ReturnType<typeof compose>>;

const CHECK_SECONDS = 2, STILLS = [0.05, 0.35, 0.65, 0.95], NOTES_REPAIR = 8;
const why = (err: unknown) => String((err as Error)?.message || err).slice(0, 160);
const errs = (x: ReturnType<typeof expand>) => x.errors.map((e) => `${e.path}: ${e.message}`.slice(0, 200));

/** Still times (s) at `at` (fractions) of `seconds`, off whole seconds, so a once-a-second beat shows two frames. */
export const stillTimes = (seconds: number, at: readonly number[] = STILLS) => at.map((f) => {
  const t = Math.round(f * seconds * 10) / 10;
  return Number.isInteger(t) ? t + 0.3 : t;
});

/**
 * A look from `adapter` in rounds. `start`: an answer to begin from instead of asking (a critique of a saved look);
 * `aim`: what the critique holds the frames to (the idea); `budgetMs`: past this since `startedAt`, no critique;
 * `critiques`: how many rounds (1; 0 renders for one but asks none); `revise`: each must change the weakest part,
 * and the first runs whatever the budget (an exploring idea is always revised once); `kind`: the first round's name
 * in the log (compose).
 */
export async function compose(o: { adapter: Adapter, ctx: Context, catalog: Catalog, box?: Box, lane?: Lane,
  critique?: Critique, aim?: string, start?: unknown, startedAt: number, budgetMs: number, stopping: () => boolean,
  log: Logger, critiques?: number, revise?: boolean, kind?: string }) {
  const { adapter, ctx, catalog } = o, id = ctx.idea?.id;
  /** One round's call (`first` sees the round before it starts): its answer, and the round, for the caller to end
   * with what came of it. */
  const ask = async (kind: string, repair?: Repair, first?: (r: Round) => void) => {
    const round = ctx.journal?.begin(kind) ?? NO_ROUND;
    first?.(round);
    try {
      return { raw: await adapter.generate({ ...ctx, ...(repair ? { repair } : {}), round }), round };
    } catch (err) {
      round.end({ outcome: `failed: ${why(err)}` });
      throw err;
    }
  };
  const made = (raw: unknown) => ({ raw, x: expand(raw, catalog) });
  const valid = ({ x }: ReturnType<typeof made>) => {
    const look = validateLook(x.look, ctx);
    look.dropped.unshift(...x.notes, ...x.errors.map((e) => `${e.path}: ${e.message}`));
    return look;
  };
  const check = (look: ReturnType<typeof valid>, seconds: number) => renderCheck(o.box, look,
    { seconds, rig: ctx.rig, lane: o.lane });
  const expanded = (x: ReturnType<typeof expand>) => `${x.errors.length} errors, ${x.notes.length} params changed`;
  let cur, rounds = 0;
  if (o.start !== undefined) cur = made(o.start);
  else {
    const a = await ask(o.kind ?? 'compose');
    cur = made(a.raw);
    a.round.end({ outcome: expanded(cur.x), notes: [...errs(cur.x), ...cur.x.notes] });
  }
  if (cur.x.errors.length && !o.stopping()) {
    rounds++;
    try {
      const a = await ask('repair', { answer: cur.raw, errors: cur.x.errors }), reason = errs(cur.x);
      cur = made(a.raw);
      a.round.end({ outcome: `for ${reason.length} errors: ${expanded(cur.x)}`, reason,
        notes: [...errs(cur.x), ...cur.x.notes] });
    } catch (err) { // the answer before, less what it got wrong, still makes a look
      o.log.warn?.(`[generate] idea ${id}: repair failed (${why(err)})`);
    }
  }
  // Many params changed: the model fixes them itself, rather than hear of them only in the critique.
  if (cur.x.notes.length > NOTES_REPAIR && !o.stopping()) {
    rounds++;
    try {
      const reason = cur.x.notes;
      const a = await ask('notes', { answer: cur.raw, errors: [], message: buildNotesMessage(reason) });
      const next = made(a.raw), better = !next.x.errors.length && next.x.notes.length < reason.length;
      const outcome = `for ${reason.length} params changed: ${expanded(next.x)}, ${better ? 'kept' : 'not kept'}`;
      a.round.end({ outcome, reason, notes: [...errs(next.x), ...next.x.notes] });
      if (better) cur = next;
    } catch (err) {
      o.log.warn?.(`[generate] idea ${id}: params repair failed (${why(err)})`);
    }
  }
  let look = valid(cur);
  const long = (l: typeof look) => (o.critique ? lookDuration(l) : CHECK_SECONDS);
  let seen: Seen | null = await check(look, long(look)), checkMs = seen?.ms ?? 0;
  if (seen?.errors.length && !o.stopping()) {
    rounds++;
    try {
      const reason = seen.errors.map((e) => `${e.path}: ${e.message}`.slice(0, 200));
      const a = await ask('runtime', { answer: cur.raw, errors: seen.errors }), next = made(a.raw);
      let outcome = `for ${reason.length} runtime errors: ${expanded(next.x)}`;
      if (!next.x.errors.length) {
        const fixed = valid(next), again = await check(fixed, long(fixed));
        checkMs += again?.ms ?? 0;
        const better = !!again && again.errors.length < seen.errors.length;
        outcome += better ? ', kept' : ', still throws';
        if (better) [cur, look, seen] = [next, fixed, again];
      }
      a.round.end({ outcome, reason });
    } catch (err) {
      o.log.warn?.(`[generate] idea ${id}: runtime repair failed (${why(err)})`);
    }
  }
  if (seen?.errors.length) look.dropped.push(...seen.errors.map((e) => `${e.path}: ${e.message}`.slice(0, 200)));

  // Each round is held to the frames of what is kept: a revision kept is rendered again for the next.
  let critique: { ms: number, outcome: string } | undefined, shown = seen;
  const t0 = Date.now(), outcomes: string[] = [];
  for (let n = 0; n < (o.critiques ?? 1) && o.critique && shown?.bytes && ctx.rig && !o.stopping(); n++) {
    if ((n > 0 || !o.revise) && Date.now() - o.startedAt > o.budgetMs) {
      outcomes.push('skipped: over budget');
      break;
    }
    let outcome = 'unchanged', round = NO_ROUND, warnings: string[] = [], sent: string[] = [];
    try {
      const aim = o.aim ?? ctx.text, seconds = shown.seconds || lookDuration(look);
      const view = viewFrames(shown.bytes, ctx.rig, { at: stillTimes(seconds), stills: o.critique === 'images',
        closeUps: closeUpGroups(look, prepareScene(ctx.rig)) });
      warnings = groupWarnings(view.groups, ctx.groups, aim);
      const message = buildCritiqueMessage({ idea: aim, timeline: view.timeline, analysis: shown.analysis,
        stills: view.stills.map((s) => s.at), closeUps: [...new Set(view.closeUps.map((c) => c.group))], seconds,
        warnings, notes: cur.x.notes, revise: o.revise });
      const images = [...view.stills, ...view.closeUps];
      sent = cur.x.notes;
      const a = await ask('critique', { answer: cur.raw, errors: [], message, images: images.map((s) => s.png) },
        (r) => images.forEach((s) => r.still(s.png, { view: 'group' in s ? s.group : 'front', at: s.at })));
      round = a.round;
      const next = made(a.raw);
      if (JSON.stringify(next.raw) === JSON.stringify(cur.raw)) outcome = 'unchanged';
      else if (next.x.errors.length) outcome = `kept: the revision named ${next.x.errors[0]!.message.slice(0, 60)}`;
      else {
        const revised = valid(next), more = n + 1 < (o.critiques ?? 1);
        const after = await check(revised, more ? long(revised) : CHECK_SECONDS);
        checkMs += after?.ms ?? 0;
        if (after?.errors.length) outcome = 'kept: the revision threw';
        else [cur, look, outcome, shown] = [next, revised, 'revised', more ? after : shown];
      }
    } catch (err) {
      outcome = `failed: ${why(err)}`;
    }
    round.end({ outcome, ...(warnings.length ? { warnings } : {}), notes: sent });
    outcomes.push(outcome);
  }
  if (outcomes.length) critique = { ms: Date.now() - t0, outcome: outcomes.join(', ') };
  return { raw: cur.raw, look, uses: cur.x.uses, rounds, check: seen ? checkMs : undefined, critique, seen };
}
