// The bake setting (SPEC "Baked frames", "The bake setting"): <STUDIO_DATA>/baking.json, { mode: on | throttled |
// off }, read as each render starts so it takes effect without a restart (missing or broken: on). governBox() puts
// it in front of the render box: off refuses, throttled renders at nice 19 and spaces renders a cooldown apart.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { FastifyRequest } from 'fastify';

import { type BakeMode, Baking, type BakingState } from '../shared/schemas/api.ts';
import { BakeError } from './box-output.ts';
import { forAdmins, HttpError } from './http.ts';
import type { LayerInput } from '../public/js/pattern-core.ts';
import type { RenderBox } from './render-box.ts';

export const THROTTLE = { nice: 19, cooldownMs: 30_000 };
export const BAKING_OFF = 'An admin turned baking off.';

type Log = { warn?: (...a: unknown[]) => void };

export function createBakingStore({ file, log = console }: { file: string, log?: Log }) {
  let sig = '', mode: BakeMode = 'on';
  const signature = () => {
    try { const st = statSync(file); return `${st.size}:${st.mtimeMs}`; } catch { return '-'; }
  };
  return {
    /** The mode as stored now: re-read when the file's size or time changed. */
    mode(): BakeMode {
      const s = signature();
      if (s === sig) return mode;
      sig = s;
      let json: unknown = null;
      try { if (s !== '-') json = JSON.parse(readFileSync(file, 'utf8')); } catch (err) {
        log.warn?.(`[baking] ${path.basename(file)} is not valid JSON (${(err as Error).message}); baking is on`);
      }
      mode = Baking.safeParse(json).data?.mode ?? 'on';
      return mode;
    },
    /** Checks and writes a new setting: { mode } or { error }. */
    save(body: unknown): { mode: BakeMode } | { error: string } {
      const parsed = Baking.safeParse(body);
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'That bake setting is not valid.' };
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(parsed.data, null, 2)}\n`);
      renameSync(tmp, file);
      [sig, mode] = [signature(), parsed.data.mode];
      return parsed.data;
    },
  };
}
export type BakingStore = ReturnType<typeof createBakingStore>;

type Box = Pick<RenderBox, 'probe' | 'render'> & { refuses?: RenderBox['refuses'], stop?(): void,
  config?: Partial<RenderBox['config']> };

/**
 * The render box under the bake setting: render() refuses while off (503) and runs throttled at nice 19; ready()
 * resolves once a throttled render may start (a cooldown after the last one ended), for callers to await outside the
 * lane (render() waits too, should two pass it at once); refusal(layers) → { status, reason } or null.
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
    async refusal(layers: readonly LayerInput[]) {
      if (mode() === 'off') return { status: 503, reason: BAKING_OFF };
      const p = await box.probe();
      if (!p.ok) return { status: 503, reason: p.reason };
      const reason = await box.refuses?.(layers);
      return reason ? { status: 422, reason } : null;
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
export type GovernedBox = ReturnType<typeof governBox>;

/** GET /api/baking for everyone signed in (the bake buttons read it); PUT /api/admin/baking for admins. */
export function bakingRoutes({ baking, box }: { baking: BakingStore, box: Pick<RenderBox, 'probe'> }) {
  const state = async (): Promise<BakingState> => {
    const p = await box.probe();
    const reason = p.ok ? p.libraryOnly : p.reason;
    const libraryOnly = p.ok && !!p.libraryOnly;
    return { mode: baking.mode(), box: { ok: p.ok, libraryOnly, ...(reason ? { reason } : {}) } };
  };
  return {
    'GET /baking': state,
    'PUT /admin/baking': forAdmins(async (req: FastifyRequest) => {
      const saved = baking.save(req.body);
      if ('error' in saved) throw new HttpError(400, saved.error);
      return state();
    }),
  };
}
