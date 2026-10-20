// The light settings on the server (SPEC "Light and output"): <STUDIO_DATA>/light.json, the one stored place. Export,
// the bake checks and the preview read it; the Light page writes it. A missing or broken file is the defaults, field
// by field (the core's lightOf), so nothing needs migrating; edits by hand apply on the next read.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { type Light, lightOf } from '../public/js/pattern-core.ts';
import { Light as LightSchema } from '../shared/schemas/light.ts';

type Log = { warn?: (...a: unknown[]) => void };

export function createLightStore({ file, log = console }: { file: string, log?: Log }) {
  let sig = '', light = lightOf();
  const signature = () => {
    try { const st = statSync(file); return `${st.size}:${st.mtimeMs}`; } catch { return '-'; }
  };
  return {
    file,
    /** The settings as stored now: re-read when the file's size or time changed. */
    current(): Light {
      const s = signature();
      if (s === sig) return light;
      sig = s;
      let json: unknown = null;
      if (s !== '-') {
        try { json = JSON.parse(readFileSync(file, 'utf8')); } catch (err) {
          const why = (err as Error).message;
          log.warn?.(`[light] ${path.basename(file)} is not valid JSON (${why}); using the defaults`);
        }
      }
      light = lightOf(json);
      return light;
    },
    /** Checks and writes new settings: { light } or { error } naming the field. */
    save(body: unknown): { light: Light } | { error: string } {
      const parsed = LightSchema.safeParse(body);
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Those light settings are not valid.' };
      const next = lightOf(parsed.data);
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
      renameSync(tmp, file);
      [sig, light] = [signature(), next];
      return { light: next };
    },
  };
}
export type LightStore = ReturnType<typeof createLightStore>;
