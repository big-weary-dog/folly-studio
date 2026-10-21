// The show's sources in a show-builder checkout, found as tools/sources.py finds them: SHOW_BUILDER_DIR, or
// show-builder/ beside this repo. Tests that need them skip, saying so, where they are missing.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHOW_BUILDER = path.resolve(process.env.SHOW_BUILDER_DIR
  || fileURLToPath(new URL('../../../show-builder', import.meta.url)));

/** The absolute path of a file in show-builder. */
export const source = (rel) => path.join(SHOW_BUILDER, rel);

/** Why a test cannot run without these show-builder paths, or '' when they are all there. */
export function missing(...rels) {
  const gone = rels.filter((rel) => !existsSync(source(rel)));
  return gone.length ? `needs ${gone.join(', ')} from show-builder (SHOW_BUILDER_DIR, now ${SHOW_BUILDER})` : '';
}
