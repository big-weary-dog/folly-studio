// One view of the look's offered faders, tempo, module settings and palette, using sandbox-reported schemas.
import type { Module } from '../../../shared/schemas/look.ts';
import { normaliseParam } from './bindings.ts';
import { humanize } from './kit.tsx';
import type { Studio } from './studio-store.ts';

function active(modules: Module[]): Module[] {
  return modules.filter((m) => m.enabled !== false
    && (!m.on || modules.find((s) => s.id === m.on)?.enabled !== false)).flatMap((m) => [m,
    ...(m.layers ?? []).filter((l) => l.enabled !== false).flatMap((l) => active(l.modules))]);
}

export function offersOf(look: Pick<Studio['look']['value'], 'globals' | 'layers'>,
  schemaFor: (layer: string, module: Module) => Record<string, unknown> | null) {
  const g = look.globals;
  const faders = g?.live ?? Object.entries(g?.macros ?? {}).filter(([, m]) => !m.mod).map(([name]) => name);
  const offers = faders.map((name) => ({ name: humanize(name), kind: name === 'bpm' ? 'Tempo' : 'Fader' }));
  for (const layer of look.layers) {
    if (layer.enabled === false) continue;
    for (const module of active(layer.modules)) {
      const schema = schemaFor(layer.id, module);
      for (const key of module.live ?? []) {
        const p = normaliseParam(key, schema?.[key]);
        if (p?.kind === 'choice' || p?.kind === 'color') offers.push({
          name: [layer.title, module.title, p.label].join(' · '), kind: p.kind === 'choice' ? 'Choice' : 'Colour',
        });
      }
    }
  }
  offers.push({ name: 'Palette', kind: 'Palette' });
  return offers;
}

export function LiveOffers({ st }: { st: Studio }) {
  const offers = offersOf(st.look.value, (layer, module) => st.status.params(layer, module).schema);
  return <section class="globals-offers" aria-label="Offered in Live Play">
    <h3 class="globals-h">Live Play</h3>
    <ul class="live-offers">{offers.map((o) => <li><span>{o.name}</span>
      {o.kind !== 'Palette' && <small>{o.kind}</small>}</li>)}</ul>
  </section>;
}
