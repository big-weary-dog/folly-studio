// The rig the Studio shows, bakes and exports (SPEC "Rig"): STUDIO_RIG, else the Folly's playa build. The one place
// a rig's name becomes its file under public/data.
import path from 'node:path';

import type { RigName } from '../shared/schemas/rig.ts';
import type { Config } from './config.ts';

export const RIG_FILES: Record<RigName, string> = { folly: 'rig-folly.json', cog: 'rig.json' };

export const rigOf = (c: Config): RigName => c.STUDIO_RIG ?? 'folly';
export const rigFileOf = (publicDir: string, rig: RigName) => path.join(publicDir, 'data', RIG_FILES[rig]);
