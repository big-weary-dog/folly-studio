// Creator-offered params: colour picks update links; choices retain an outgoing instance for a layer crossfade.
import { compileLayer, prepareLayer, type PreparedLayer, type Scene } from '../../public/js/pattern-core.ts';
import { flatModules, mapEvery } from '../../public/js/core/tree.ts';
import { applyMods, paramMods } from '../../public/js/core/globals.ts';
import { DEFAULT_PALETTE, type PaletteHex } from '../../public/js/core/stdlib.ts';
import type { PiLook } from './library.ts';
import { ColourValue, type Control, type SavedColour, type SettingValue } from './protocol.ts';
import { readPick } from '../../public/js/core/picks.ts';
import { runChain } from '../../public/js/core/render.ts';
import { PLACE } from '../../public/js/core/place.ts';

export const CHOICE_FADE = 0.5; // seconds; the owner's initial choice-switch duration

type Setting = Extract<Control, { kind: 'choice' | 'color' }>;
function colour(link: PreparedLayer['all'][number], key: string, value: SettingValue) {
  link.saved[key] = value;
  link.picks?.bind(link.schema, link.saved, link.P);
  link.mods = paramMods(link.schema, link.saved, link.picks?.rot);
}
export function liveSettings(look: PiLook, layers: PreparedLayer[], scene?: Scene) {
  const entries = new Map<string, { c: Setting, write: (value: SettingValue) => void }>();
  let revision = 0;
  type Fade = { elapsed: number, layer: PreparedLayer, start: () => void,
    colour: (index: number, key: string, value: SettingValue) => void };
  const fades = new Map<PreparedLayer, Fade>(), active: Fade[] = [];
  for (const [i, layer] of look.layers.entries()) {
    if (!layer.id || layer.enabled === false) continue;
    for (const m of flatModules(layer.modules ?? [])) {
      if (!m.id || m.enabled === false) continue;
      // Attached sources also have a synthetic wrapper with their ID; the real link owns the schema.
      const link = layers[i]?.all.find((l) => l.id === m.id && Object.keys(l.schema).length);
      if (!link) continue;
      const linkIndex = layers[i].all.indexOf(link);
      for (const key of m.live ?? []) {
        const d = link.schema[key];
        if (!d || d.type !== 'choice' && d.type !== 'color') continue;
        const name = JSON.stringify([layer.id, m.id, key]);
        const label = [layer.title || layer.id, m.title || m.id, d.label || key].join(' · ');
        const own = d.type === 'choice' ? link.P[key] as string
          : readPick(link.saved[key]) ? link.saved[key] as SavedColour : d.value;
        const c: Setting = d.type === 'choice'
          ? { name, label, setting: d.label || key, kind: 'choice', value: own as string, default: own as string,
            options: d.options, held: false }
          : { name, label, setting: d.label || key, kind: 'color', value: own, default: own, held: false,
            palette: look.globals?.palette ?? DEFAULT_PALETTE };
        entries.set(name, { c, write(value) {
          let link = layers[i].all[linkIndex];
          if (scene && c.kind === 'choice' && link.P[key] !== value) {
            const layer = layers[i];
            let fade = fades.get(layer);
            if (!fade) {
              const old = new Float64Array(layer.buf.length), next = new Float64Array(old.length);
              const visible = new Float64Array(old.length); // before clip wipes, which the compositor applies once
              let frozen = false, rendered = false, outgoing = layer;
              fade = { elapsed: 0, layer, colour(index, key, value) {
                colour(outgoing.all[index], key, value);
              }, start() {
                if (this.layer.beforeComposite) {
                  if (rendered) { frozen = true; old.set(visible); }
                }
                else {
                  frozen = rendered = false;
                  active.push(this);
                  // Keep the outgoing instance's history; the incoming choice owns separate module state.
                  outgoing = this.layer;
                  fades.delete(outgoing);
                  this.layer = prepareLayer(scene, look.layers[i], compileLayer(look.layers[i]));
                  for (let j = 0; j < outgoing.all.length; j++) {
                    const from = outgoing.all[j], to = this.layer.all[j];
                    Object.assign(to.saved, from.saved); Object.assign(to.P, from.P);
                    to.picks?.bind(to.schema, to.saved, to.P);
                    to.mods = paramMods(to.schema, to.saved, to.picks?.rot);
                  }
                  layers[i] = this.layer;
                  fades.set(this.layer, this);
                }
                this.elapsed = 0;
                this.layer.beforeComposite = (scene, T, G, t, env, L) => {
                  const layer = fade!.layer;
                  const amount = Math.min(1, fade!.elapsed / CHOICE_FADE);
                  next.set(layer.buf);
                  if (!frozen) {
                    for (const m of outgoing.all) {
                      if (m.mods.length) applyMods(m.mods, m.P, t, env, L);
                      m.picks?.frame();
                    }
                    PLACE.layer = outgoing;
                    const error = runChain(scene, outgoing, T, G);
                    PLACE.layer = layer;
                    if (error) { layer.failed = outgoing.failed; return error; }
                    old.set(outgoing.buf);
                  }
                  for (let j = 0; j < next.length; j += 4) {
                    const a = old[j + 3] * (1 - amount), b = next[j + 3] * amount, alpha = a + b;
                    for (let c = 0; c < 3; c++) {
                      layer.buf[j + c] = alpha > 0 ? (old[j + c] * a + next[j + c] * b) / alpha : 0;
                    }
                    layer.buf[j + 3] = alpha;
                  }
                  visible.set(layer.buf);
                  rendered = true;
                };
              } };
              fades.set(layer, fade);
            }
            fade.start();
            link = layers[i].all[linkIndex];
          }
          link.saved[key] = value;
          if (c.kind === 'choice') link.P[key] = value as string;
          else {
            colour(link, key, value);
            if (layers[i].beforeComposite) fades.get(layers[i])?.colour(linkIndex, key, value);
          }
          revision++;
        } });
      }
    }
  }
  const controls = [...entries.values()].map(({ c }) => c);
  return {
    controls,
    step(dt: number) {
      for (let i = active.length - 1; i >= 0; i--) {
        const fade = active[i];
        fade.elapsed += dt;
        if (fade.elapsed + 1e-9 < CHOICE_FADE) continue;
        fade.layer.beforeComposite = null;
        active[i] = active[active.length - 1]; active.pop();
      }
    },
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
