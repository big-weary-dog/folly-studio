// The light settings (SPEC "Light and output"): how the LEDs turn a colour value into light. The Light page saves
// this shape, checked here with a message per field; reading a stored file is lenient (the core's lightOf).
import { z } from 'zod';

import { LIGHT_LIMITS } from '../../public/js/pattern-core.ts';

const share = (name: string) => z.number({ error: `${name} must be a number.` })
  .min(0, { error: `${name} must be at least 0.` }).max(1, { error: `${name} must be at most 1 (100 %).` });
const text = (name: string) => z.string({ error: `${name} must be text.` }).trim()
  .max(LIGHT_LIMITS.text, { error: `${name} must be at most ${LIGHT_LIMITS.text} characters.` });
const [f0, f1] = LIGHT_LIMITS.floor, L = LIGHT_LIMITS;
const range = (name: string, [lo, hi]: readonly number[]) => z.number({ error: `${name} must be a number.` })
  .min(lo!, { error: `${name} must be at least ${lo}.` }).max(hi!, { error: `${name} must be at most ${hi}.` });

export const Light = z.strictObject({
  gamma: range('gamma', L.gamma),
  balance: z.tuple([share('red balance'), share('green balance'), share('blue balance')],
    { error: 'balance must be three numbers.' }),
  floor: z.int({ error: 'floor must be a whole number.' }).min(f0, { error: `floor must be at least ${f0}.` })
    .max(f1, { error: `floor must be at most ${f1}.` }),
  trims: z.array(z.strictObject({ tag: text('a trim\'s tag').min(1, { error: 'a trim needs a tag.' }),
    level: share('a trim\'s level') })).max(LIGHT_LIMITS.trims, { error: `at most ${LIGHT_LIMITS.trims} trims.` }),
  controller: z.array(z.strictObject({ ports: text('ports'), brightness: share('a port\'s brightness'),
    gamma: text('a port\'s gamma') }))
    .max(LIGHT_LIMITS.controller, { error: `at most ${LIGHT_LIMITS.controller} controller rows.` }),
  calibration: z.strictObject({
    white: z.tuple([range('red white', L.white), range('green white', L.white), range('blue white', L.white)]),
    response: range('response', L.response), saturation: range('saturation', L.saturation),
  }, { error: 'calibration must be how the real LEDs look.' }),
  preview: z.strictObject({
    exposure: range('exposure', L.exposure), bloom: share('bloom'), highlight: share('the highlight\'s dim'),
    focus: share('the focus\'s dim'),
  }, { error: 'preview must be the display settings.' }),
});
export type LightSettings = z.infer<typeof Light>;
