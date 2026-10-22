// The Custom code switch (SPEC-baking "Custom code"): while an admin has it off, no new pattern code reaches the
// render box. A look saved, by hand or by a generator, may carry only code the server has already: a library
// pattern's file exactly (by SHA-256), or code in a look its owner can see (theirs or shared, any version).
import { createHash } from 'node:crypto';

import { libraryHashes } from './box-library.ts';
import type { StoredLook } from './store.ts';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const named = (v: unknown) => (typeof v === 'string' ? v.slice(0, 60) : '');

/** Every piece of code in `layers` (a layer's own, its modules', its composites' sub-layers'), with where it is. */
export function* codesOf(layers: unknown, at = ''): Generator<{ code: string, where: string }> {
  for (const [i, l] of (Array.isArray(layers) ? layers : []).entries()) {
    if (!isObj(l)) continue;
    const where = at || `Layer ${i + 1}${named(l.title) ? ` (${named(l.title)})` : ''}`;
    if (typeof l.code === 'string') yield { code: l.code, where };
    for (const m of Array.isArray(l.modules) ? l.modules : []) {
      if (!isObj(m)) continue;
      if (typeof m.code === 'string') yield { code: m.code, where: `${where}'s ${named(m.title) || 'module'}` };
      yield* codesOf(m.layers, where);
    }
  }
}

/**
 * The switch in front of saving: refuses(layers, owner) → why the look cannot be saved now ('' when it can), check()
 * throws it; open() whether the switch is on; allows(owner) → a test of one piece of code, for a generator's rounds.
 */
export function createCodeGate({ on, looks, patternsDir }: { on: () => boolean, patternsDir: string,
  looks: { list(match: (l: StoredLook) => unknown): StoredLook[] } }) {
  let hashes: Promise<Set<string>> | undefined;   // the library changes only with a deploy, which restarts
  const library = () => (hashes ??= libraryHashes(patternsDir));
  /** The code in looks `owner` can see. */
  function seenBy(owner: string) {
    const seen = new Set<string>();
    for (const look of looks.list((l) => l.owner === owner || l.shared === true)) {
      for (const layers of [look.layers, ...(look.versions ?? []).map((v) => v.layers)]) {
        for (const { code } of codesOf(layers)) seen.add(code);
      }
    }
    return seen;
  }
  async function refuses(layers: unknown, owner: string) {
    if (on()) return '';
    const lib = await library(), fresh = [...codesOf(layers)].filter((c) => !lib.has(sha256(c.code)));
    const seen = fresh.length ? seenBy(owner) : null, bad = fresh.find((c) => !seen!.has(c.code));
    return bad ? 'An admin turned custom code off, so a look takes only library modules and code already in looks '
      + `here; ${bad.where} is new code.` : '';
  }
  return {
    /** Whether looks may take new code now. */
    open: on,
    refuses,
    async check(layers: unknown, owner: string, fail: (why: string) => Error) {
      const why = await refuses(layers, owner);
      if (why) throw fail(why);
    },
    async allows(owner: string): Promise<(code: string) => boolean> {
      if (on()) return () => true;
      const lib = await library(), seen = seenBy(owner);
      return (code) => seen.has(code) || lib.has(sha256(code));
    },
  };
}
export type CodeGate = ReturnType<typeof createCodeGate>;
