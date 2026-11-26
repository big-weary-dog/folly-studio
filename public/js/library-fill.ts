// Only library code runs (spec/looks "Modules"): the sandbox's worker takes each module's code from the library init
// gave it, by its `ref`, whatever the look holds ('' for a ref the library lacks, which then fails to compile).
type Module = { ref?: string, code?: string, layers?: readonly { modules?: readonly Module[] }[] };

/** `modules` with each one's code its ref's library file; a composite's sub-layers' too. What is not a module goes. */
function filled(modules: readonly Module[] | undefined, codes: ReadonlyMap<string, string>): Module[] {
  const list = <T>(v?: readonly T[]) => (Array.isArray(v) ? v : []).filter((x) => !!x && typeof x === 'object');
  return list(modules).map((m) => (m.layers
    ? { ...m, layers: list(m.layers).map((s) => ({ ...s, modules: filled(s.modules, codes) })) }
    : { ...m, code: (typeof m.ref === 'string' && codes.get(m.ref)) || '' }));
}

/** `layers` as the engine plays them: every module's code from the library by ref. */
export function fromLibrary<L extends { modules?: readonly Module[] }>(layers: readonly L[],
  codes: ReadonlyMap<string, string>): L[] {
  return layers.map((l) => ({ ...l, modules: filled(l.modules, codes) }) as L);
}
