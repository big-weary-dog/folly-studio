// Exploring before committing (SPEC-generators "Explore"). Explore: one sketch turn (three takes on the idea, differing
// in lead, motion, scale, colour and tempo, and a synthesis saying what it took from each), then the synthesis
// composed in rounds (rounds.ts) with a critique that must change its weakest part. Deep: the three takes composed
// and rendered side by side, one look composed from what they showed, then two such critiques. A sketch turn that
// fails or answers no three takes leaves the idea to the quick rounds. Effort is raised for the whole idea.

import { type Explore } from '../../shared/schemas/api.ts';
import { EFFORTS, type ModelEntry, type Transport } from '../../shared/schemas/models.ts';
import {
  buildDeepMessage, buildSketchMessage, buildSynthesisMessage, buildTakeMessage, readSketches, SKETCH_SCHEMA,
  type Sketches,
} from './explore-prompt.ts';
import { viewFrames } from './frames-view.ts';
import { NO_ROUND } from './idea-log.ts';
import { compose, stillTimes } from './rounds.ts';

type Options = Parameters<typeof compose>[0];
type Level = Exclude<Explore, 'quick'>;

/** Each level's least effort, critique rounds and the time past which no critique but the first starts. */
export const LEVELS: Record<Level, { effort: string, critiques: number, budgetMs: number }> = {
  explore: { effort: 'high', critiques: 1, budgetMs: 360_000 },
  deep: { effort: 'xhigh', critiques: 2, budgetMs: 720_000 },
};
const TAKE_STILLS = [0.3, 0.7]; // of each take's length
const why = (err: unknown) => String((err as Error)?.message || err).slice(0, 160);

/** The model entry as `level` runs it: its effort raised to the level's, where its transport has that one. */
export function boosted(via: Transport, entry: ModelEntry | undefined, level: Level): ModelEntry | undefined {
  const order = EFFORTS[via], want = LEVELS[level].effort;
  if (!order.includes(want)) return entry;
  const at = order.indexOf(entry?.effort ?? (via === 'claude' ? 'medium' : 'low'));
  return at >= order.indexOf(want) ? entry
    : { ...(entry ?? { id: via, label: via, via, enabled: true }), effort: want } as ModelEntry;
}

/** The idea composed at `level`: the rounds' answer, and the sketch turn's time and outcome. */
export async function explore(o: Options & { level: Level }) {
  const { ctx, level } = o, t0 = Date.now(), { critiques } = LEVELS[level];
  const mode = o.critique ?? 'images';
  let sketches: Sketches | null = null, failed = '';
  const round = ctx.journal?.begin('sketch') ?? NO_ROUND;
  try {
    sketches = readSketches(await o.adapter.generate({ ...ctx, turn: buildSketchMessage(ctx.text, ctx.groups),
      schema: SKETCH_SCHEMA, round }));
    if (!sketches) failed = 'not three takes';
  } catch (err) {
    failed = why(err);
  }
  round.end({ outcome: failed ? `failed: ${failed}` : sketches!.takes.map((t) => t.name).join(', '),
    ...(sketches ? { took: sketches.synthesis.took, brief: sketches.synthesis.brief } : {}) });
  const ms = Date.now() - t0;
  if (!sketches || o.stopping()) {
    o.log.warn?.(`[generate] idea ${ctx.idea?.id}: sketching failed (${failed || 'stopping'}); composing directly`);
    return { ...await compose(o), sketch: { ms, outcome: `failed: ${failed || 'stopping'}`, took: '' } };
  }
  const aim = `${ctx.text}\n\nThe plan: ${sketches.synthesis.brief}`;
  const sketch = { ms, outcome: `${sketches.takes.map((t) => t.name).join(', ')}`,
    took: sketches.synthesis.took };
  if (level === 'explore') {
    return { ...await compose({ ...o, ctx: { ...ctx, turn: buildSynthesisMessage(ctx.text, sketches) }, aim,
      critique: mode, critiques, revise: true }), sketch };
  }
  // Deep: the takes built at once (rendered as a critique would see them, none asked), then one look from them.
  const s = sketches;
  const built = await Promise.all(s.takes.map((_, i) => compose({ ...o, ctx: { ...ctx,
    turn: buildTakeMessage(ctx.text, s, i) }, critique: mode, critiques: 0, kind: 'take' }).then((b) => {
    const view = b.seen?.bytes && ctx.rig ? viewFrames(b.seen.bytes, ctx.rig, {
      at: stillTimes(b.seen.seconds, TAKE_STILLS), stills: mode === 'images', closeUps: [] }) : null;
    return { answer: b.raw, timeline: view?.timeline ?? '(not rendered)', stills: view?.stills ?? [] };
  }, (err) => {
    o.log.warn?.(`[generate] idea ${ctx.idea?.id}: take ${i + 1} failed (${why(err)})`);
    return null;
  })));
  const images = built.flatMap((b) => b?.stills.map((st) => st.png) ?? []);
  const turn = buildDeepMessage(ctx.text, s, built.map((b) => b && { ...b, stills: b.stills.map((st) => st.at) }));
  const takes = { ...sketch, ms: Date.now() - t0 };
  return { ...await compose({ ...o, ctx: { ...ctx, turn, images }, aim, critique: mode, critiques, revise: true }),
    sketch: takes };
}
