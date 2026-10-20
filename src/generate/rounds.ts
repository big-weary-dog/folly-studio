// The rounds inside one idea (SPEC-generators "Composition", "The render check", "Critique"): the model's
// composition, expanded; one repair round when it names what the library lacks; the render check, with one more
// repair round when the look throws in the box; then, when the model has it, one critique round on what rendered.
// None of it is another use. A later round's answer is kept only when it expands and renders no worse.

import { prepareScene } from '../../public/js/pattern-core.ts';
import { validateLook } from '../../shared/schemas/generated.ts';
import type { Catalog } from './catalog.ts';
import { type Box, renderCheck, type Seen } from './check.ts';
import { expand } from './expand.ts';
import { closeUpGroups } from './frames-closeup.ts';
import { viewFrames } from './frames-view.ts';
import type { Adapter, Context, Repair } from './index.ts';
import { buildCritiqueMessage } from './prompt.ts';
import type { Logger } from '../http.ts';

type Lane = Parameters<typeof renderCheck>[2]['lane'];
export type Critique = 'images' | 'text';
export type Rounds = Awaited<ReturnType<typeof compose>>;

const CHECK_SECONDS = 2, CRITIQUE_SECONDS = 8, STILLS = [1, 4.3, 7.6]; // off whole seconds: a beat shows 2 frames
const why = (err: unknown) => String((err as Error)?.message || err).slice(0, 160);

/**
 * A look from `adapter` in rounds. `start`: an answer to begin from instead of asking (a critique of a saved look);
 * `aim`: what the critique holds the frames to (the idea); `budgetMs`: past this since `startedAt`, no critique.
 */
export async function compose(o: { adapter: Adapter, ctx: Context, catalog: Catalog, box?: Box, lane?: Lane,
  critique?: Critique, aim?: string, start?: unknown, startedAt: number, budgetMs: number, stopping: () => boolean,
  log: Logger }) {
  const { adapter, ctx, catalog } = o, id = ctx.idea?.id;
  const ask = async (repair?: Repair) => adapter.generate(repair ? { ...ctx, repair } : ctx);
  const made = (raw: unknown) => ({ raw, x: expand(raw, catalog) });
  const valid = ({ x }: ReturnType<typeof made>) => {
    const look = validateLook(x.look, ctx);
    look.dropped.unshift(...x.notes, ...x.errors.map((e) => `${e.path}: ${e.message}`));
    return look;
  };
  const check = (look: ReturnType<typeof valid>, seconds: number) => renderCheck(o.box, look,
    { seconds, rig: ctx.rig, lane: o.lane });
  let cur = made(o.start !== undefined ? o.start : await ask()), rounds = 0;
  if (cur.x.errors.length && !o.stopping()) {
    rounds++;
    try {
      cur = made(await ask({ answer: cur.raw, errors: cur.x.errors }));
    } catch (err) { // the answer before, less what it got wrong, still makes a look
      o.log.warn?.(`[generate] idea ${id}: repair failed (${why(err)})`);
    }
  }
  let look = valid(cur);
  const long = o.critique ? CRITIQUE_SECONDS : CHECK_SECONDS;
  let seen: Seen | null = await check(look, long), checkMs = seen?.ms ?? 0;
  if (seen?.errors.length && !o.stopping()) {
    rounds++;
    try {
      const next = made(await ask({ answer: cur.raw, errors: seen.errors }));
      if (!next.x.errors.length) {
        const fixed = valid(next), again = await check(fixed, long);
        checkMs += again?.ms ?? 0;
        if (again && again.errors.length < seen.errors.length) [cur, look, seen] = [next, fixed, again];
      }
    } catch (err) {
      o.log.warn?.(`[generate] idea ${id}: runtime repair failed (${why(err)})`);
    }
  }
  if (seen?.errors.length) look.dropped.push(...seen.errors.map((e) => `${e.path}: ${e.message}`.slice(0, 200)));

  let critique: { ms: number, outcome: string } | undefined;
  if (o.critique && seen?.bytes && ctx.rig && !o.stopping()) {
    const t0 = Date.now();
    let outcome = 'skipped: over budget';
    if (t0 - o.startedAt <= o.budgetMs) {
      try {
        const view = viewFrames(seen.bytes, ctx.rig, { at: STILLS, stills: o.critique === 'images',
          closeUps: closeUpGroups(look, prepareScene(ctx.rig)) });
        const message = buildCritiqueMessage({ idea: o.aim ?? ctx.text, timeline: view.timeline,
          analysis: seen.analysis, stills: view.stills.map((s) => s.at), closeUps: [...new Set(view.closeUps
            .map((c) => c.group))] });
        const images = [...view.stills, ...view.closeUps].map((s) => s.png);
        const next = made(await ask({ answer: cur.raw, errors: [], message, images }));
        if (JSON.stringify(next.raw) === JSON.stringify(cur.raw)) outcome = 'unchanged';
        else if (next.x.errors.length) outcome = `kept: the revision named ${next.x.errors[0]!.message.slice(0, 60)}`;
        else {
          const revised = valid(next), after = await check(revised, CHECK_SECONDS);
          checkMs += after?.ms ?? 0;
          if (after?.errors.length) outcome = 'kept: the revision threw';
          else [cur, look, outcome] = [next, revised, 'revised'];
        }
      } catch (err) {
        outcome = `failed: ${why(err)}`;
      }
    }
    critique = { ms: Date.now() - t0, outcome };
  }
  return { raw: cur.raw, look, uses: cur.x.uses, rounds, check: seen ? checkMs : undefined, critique };
}
