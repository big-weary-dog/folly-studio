// The selected layer's Soften row (SPEC "Spatial modules"): a blur after its whole chain, so hard edges (bars, chases)
// lose their stair-steps. Radius in metres (0: off) and where it reaches: along the wire, in space, or both.
import type { Soften } from '../../../shared/schemas/look.ts';
import { BLUR_MODES, MAX_RADIUS } from '../core/spatial.ts';
import { Field, Scrub } from './kit.tsx';
import type { Layer } from './model.ts';
import type { Studio } from './studio-store.ts';

// Short, so the field keeps the row's width; the title says what each means.
const MODES: Record<Soften['mode'], [string, string]> = { wire: ['Wire', 'Along each strand only'],
  space: ['Space', 'Every LED within the radius'], both: ['Both', 'Along the strand and through space'] };

export function SoftenRow({ st, l }: { st: Studio; l: Layer | null }) {
  const radius = l?.soften?.radius ?? 0, mode = l?.soften?.mode ?? 'wire';
  const set = (patch: Partial<Soften>) => {
    if (l) st.editLayer(l.id, () => ({ soften: { radius, mode, ...patch } }));
  };
  return (
    <Field label="Soften" class="soften-field" tour="soften"
      title="Blurs the layer's colours across neighbouring LEDs after its chain: 0 is off">
      {(id) => <>
        <Scrub id={id} min={0} max={MAX_RADIUS * 100} step={1} unit=" cm" value={Math.round(radius * 100)}
          disabled={!l} set={(cm) => set({ radius: cm / 100 })} />
        <select class="soften-mode" aria-label="Soften along" value={mode} disabled={!l}
          onChange={(e) => set({ mode: e.currentTarget.value as Soften['mode'] })}>
          {BLUR_MODES.map((m) => <option value={m} title={MODES[m][1]}>{MODES[m][0]}</option>)}</select></>}
    </Field>);
}
