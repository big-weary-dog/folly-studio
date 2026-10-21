// The show's sources, found as tools/sources.py finds them: a lighting checkout (LIGHTING_DIR, or lighting/ beside
// this repo) for the data tests, and a show-builder checkout (SHOW_BUILDER_DIR, or show-builder/ beside it) for
// Mirage and the relay in `npm run e2e`. Tests that need them skip, saying so, where they are missing.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const beside = (name) => fileURLToPath(new URL(`../../../${name}`, import.meta.url));
export const LIGHTING = path.resolve(process.env.LIGHTING_DIR || beside('lighting'));
export const SHOW_BUILDER = path.resolve(process.env.SHOW_BUILDER_DIR || beside('show-builder'));

const why = (root, repo, env) => (...rels) => {
  const gone = rels.filter((rel) => !existsSync(path.join(root, rel)));
  return gone.length ? `needs ${gone.join(', ')} from ${repo} (${env}, now ${root})` : '';
};

/** Why a test cannot run without these lighting paths, or '' when they are all there. */
export const missingLighting = why(LIGHTING, 'lighting', 'LIGHTING_DIR');

/** Why a test cannot run without these show-builder paths, or '' when they are all there. */
export const missing = why(SHOW_BUILDER, 'show-builder', 'SHOW_BUILDER_DIR');
