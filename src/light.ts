// The light settings on the server (SPEC "Light and output"): <STUDIO_DATA>/light.json, the one stored place. Export,
// the bake checks and the preview read it; the Light page writes it. A missing or broken file is the defaults, field
// by field (the core's lightOf), so nothing needs migrating; edits by hand apply on the next read.
import { type Light, lightOf } from '../core/pattern-core.ts';
import { Light as LightSchema } from '../shared/schemas/light.ts';
import { settingsFile } from './settings-file.ts';

type Log = { warn?: (...a: unknown[]) => void };

export function createLightStore({ file, log = console }: { file: string, log?: Log }) {
  const stored = settingsFile({ file, parse: lightOf, broken: 'using the defaults', log });
  return {
    /** The settings as stored now. */
    current: stored.current,
    /** Checks and writes new settings: { light } or { error } naming the field. */
    async save(body: unknown): Promise<{ light: Light } | { error: string }> {
      const parsed = LightSchema.safeParse(body);
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Those light settings are not valid.' };
      return { light: await stored.save(lightOf(parsed.data)) };
    },
  };
}
export type LightStore = ReturnType<typeof createLightStore>;
