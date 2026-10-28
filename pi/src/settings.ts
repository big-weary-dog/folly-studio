// Creator-offered module params, addressed by IDs: mutate prepared links without recompiling or resetting clocks.
import type { PreparedLayer } from '../../public/js/pattern-core.ts';
import { flatModules, mapEvery } from '../../public/js/core/tree.ts';
import { paramMods } from '../../public/js/core/globals.ts';
import { DEFAULT_PALETTE, type PaletteHex } from '../../public/js/core/stdlib.ts';
import type { PiLook } from './library.ts';
import { ColourValue, type Control, type SettingValue } from './protocol.ts';

type Setting = Extract<Control, { kind: 'choice' | 'color' }>;
export function liveSettings(look: PiLook, layers: PreparedLayer[]) {
  const entries = new Map<string, { c: Setting, write: (value: SettingValue) => void }>();
  let revision = 0;
  for (const [i, layer] of look.layers.entries()) {
    if (!layer.id || layer.enabled === false) continue;
    for (const m of flatModules(layer.modules ?? [])) {
      if (!m.id || m.enabled === false) continue;
      // Attached sources also have a synthetic wrapper with their ID; the real link owns the schema.
      const link = layers[i]?.all.find((l) => l.id === m.id && Object.keys(l.schema).length);
      if (!link) continue;
      for (const key of m.live ?? []) {
        const d = link.schema[key];
        if (!d || d.type !== 'choice' && d.type !== 'color') continue;
        const name = JSON.stringify([layer.id, m.id, key]);
        const label = [layer.title || layer.id, m.title || m.id, d.label || key].join(' · ');
        const own = d.type === 'choice' ? link.P[key] as string
          : ColourValue.safeParse(link.saved[key]).data ?? d.value;
        const c: Setting = d.type === 'choice'
          ? { name, label, setting: d.label || key, kind: 'choice', value: own as string, default: own as string,
            options: d.options, held: false }
          : { name, label, setting: d.label || key, kind: 'color', value: own, default: own, held: false,
            palette: look.globals?.palette ?? DEFAULT_PALETTE };
        entries.set(name, { c, write(value) {
          link.saved[key] = value;
          if (c.kind === 'choice') link.P[key] = value as string;
          else {
            link.picks?.bind(link.schema, link.saved, link.P);
            link.mods = paramMods(link.schema, link.saved, link.picks?.rot);
          }
          revision++;
        } });
      }
    }
  }
  const controls = [...entries.values()].map(({ c }) => c);
  return {
    controls,
    get revision() { return revision; },
    has: (name: string) => entries.has(name),
    set(name: string, value: SettingValue) {
      const e = entries.get(name);
      if (!e) return false;
      const c = e.c;
      if (c.kind === 'choice') {
        if (typeof value !== 'string' || !c.options.includes(value)) return false;
        c.value = value;
      } else {
        const parsed = ColourValue.safeParse(value);
        if (!parsed.success) return false;
        c.value = parsed.data;
      }
      e.write(c.value);
      c.held = true;
      return true;
    },
    release(name: string) {
      const e = entries.get(name);
      if (!e) return false;
      e.c.value = e.c.default;
      e.c.held = false;
      e.write(e.c.default);
      return true;
    },
    palette(palette: PaletteHex) {
      for (const c of controls) if (c.kind === 'color') c.palette = palette;
    },
    layers() {
      return look.layers.map((l) => ({ ...l, modules: mapEvery(l.modules ?? [], (m) => {
        const params = { ...m.params };
        for (const key of m.live ?? []) {
          const e = entries.get(JSON.stringify([l.id, m.id, key]));
          if (e) params[key] = e.c.value;
        }
        return { ...m, params };
      }) }));
    },
  };
}
