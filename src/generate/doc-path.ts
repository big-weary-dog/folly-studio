// Which file of the library docs a `read_doc` path means. Shared by the claude adapter (the tree in memory) and the
// codex MCP server (the tree on disk), so it imports only node's own. Lenient in what it takes (`sources/bars`, `bars`,
// `library/warps/`), strict in what it gives: a relative path of plain names under library/, ending .md.

import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

const KINDS = ['sources', 'warps', 'filters', 'presets'];
const SAFE = /^library(?:\/[a-z0-9-]+)*\/[A-Za-z0-9-]+\.md$/;

/** The tree paths `raw` could mean, most likely first; [] for anything that is not a plain path in the tree. */
export function docCandidates(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length > 200) return [];
  let s = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (s.startsWith('/') || s.split('/').some((part) => part === '..' || part === '.')) return [];
  if (s !== 'library' && !s.startsWith('library/')) s = s ? `library/${s}` : 'library';
  const bare = s.replace(/\.md$/, '');
  const name = bare.split('/').length === 2 ? bare.slice('library/'.length) : '';
  return [`${bare}.md`, `${bare}/README.md`, ...(name ? KINDS.map((k) => `library/${k}/${name}.md`) : [])]
    .filter((p) => SAFE.test(p));
}

export const READ_CAP = 8;

export const READ_DOC_DESCRIPTION = 'Read one file of the library docs: library/README.md (how the pieces combine), '
  + 'library/<kind>/README.md (its modules by category; kinds: sources, warps, filters, presets) or '
  + 'library/<kind>/<name>.md (a module\'s params, pairings and pitfalls). Only for a page the turn does not carry; '
  + 'at most 8 reads.';

/** The text of the first candidate that is a regular file whose real path is inside `dir` (itself a real path),
 * with its tree path; null if none. */
export function readInside(dir: string, raw: unknown) {
  for (const rel of docCandidates(raw)) {
    try {
      const real = realpathSync(path.join(dir, rel));
      if (!real.startsWith(dir + path.sep) || !statSync(real).isFile()) continue;
      return { rel, text: readFileSync(real, 'utf8') };
    } catch { /* the next candidate */ }
  }
  return null;
}
