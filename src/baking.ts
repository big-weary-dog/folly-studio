// The bake setting (SPEC "Baked frames", "The bake setting"): <STUDIO_DATA>/baking.json, { mode: on | throttled |
// off }, read as each render starts so it takes effect without a restart (missing or broken: on); other keys an older
// file has are ignored.
// governBox() puts it in front of the render box: off refuses, throttled renders at nice 19 and spaces renders a
// cooldown apart.
import type { FastifyRequest } from 'fastify';

import { type BakeMode, Baking, type BakingState } from '../shared/schemas/api.ts';
import { BakeError } from './box-output.ts';
import { forAdmins, HttpError } from './http.ts';
import type { RenderBox } from './render-box.ts';
import { settingsFile } from './settings-file.ts';

export const THROTTLE = { nice: 19, cooldownMs: 30_000 };
const BAKING_OFF = 'An admin turned baking off.';

type Log = { warn?: (...a: unknown[]) => void };
type Setting = { mode: BakeMode };

export function createBakingStore({ file, log = console }: { file: string, log?: Log }) {
  const stored = settingsFile({ file, broken: 'baking is on', log, parse: (json): Setting => {
    const data = Baking.loose().safeParse(json).data;
    return { mode: data?.mode ?? 'on' };
  } });
  return {
    current: (): Setting => stored.current(),
    mode: (): BakeMode => stored.current().mode,
    /** Checks a change and writes the setting with it: the setting, or { error }. */
    async save(body: unknown): Promise<Setting | { error: string }> {
      const parsed = Baking.safeParse(body);
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'That bake setting is not valid.' };
      return stored.save({ mode: parsed.data.mode });
    },
  };
}
type BakingStore = ReturnType<typeof createBakingStore>;

type Box = Pick<RenderBox, 'probe' | 'render'> & { stop?(): void, config?: Partial<RenderBox['config']> };

/**
 * The render box under the bake setting: render() refuses while off (503) and runs throttled at nice 19; ready()
 * resolves once a throttled render may start (a cooldown after the last one ended), for callers to await outside the
 * lane (render() waits too, should two pass it at once); refusal() → { status, reason } or null.
 */
export function governBox(box: Box, mode: () => BakeMode, { cooldownMs = THROTTLE.cooldownMs, now = Date.now } = {}) {
  let ended = -Infinity;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms).unref?.());
  async function ready() {
    for (let left; mode() === 'throttled' && (left = ended + cooldownMs - now()) > 0;) await wait(Math.min(left, 1000));
  }
  return {
    ...box,
    ready,
    async refusal() {
      if (mode() === 'off') return { status: 503, reason: BAKING_OFF };
      const p = await box.probe();
      return p.ok ? null : { status: 503, reason: p.reason };
    },
    async render(job: Parameters<Box['render']>[0]) {
      await ready();
      const m = mode();
      if (m === 'off') throw Object.assign(new BakeError(BAKING_OFF), { status: 503 });
      try {
        return await box.render(m === 'throttled' ? { ...job, nice: THROTTLE.nice } : job);
      } finally {
        ended = now();
      }
    },
  };
}

/** GET /api/baking for everyone signed in (the bake buttons read it); PUT /api/admin/baking for admins. */
export function bakingRoutes({ baking, box }: { baking: BakingStore, box: Pick<RenderBox, 'probe'> }) {
  const state = async (): Promise<BakingState> => {
    const p = await box.probe();
    return { ...baking.current(), box: p.ok ? { ok: true } : { ok: false, reason: p.reason } };
  };
  return {
    'GET /baking': state,
    'PUT /admin/baking': forAdmins(async (req: FastifyRequest) => {
      const saved = await baking.save(req.body);
      if ('error' in saved) throw new HttpError(400, saved.error);
      return state();
    }),
  };
}
