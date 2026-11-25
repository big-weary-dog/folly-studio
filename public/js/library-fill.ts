// Only library code runs (spec/looks "Modules"): what the engine is sent takes each module's code from the library
// by its `ref`, whatever the look holds ('' for a ref the library lacks, which then fails to compile).
type Module = { ref?: string, code?: string, layers?: { modules: Module[] }[] };

/** `modules` with each one's code its ref's library file; a composite's sub-layers' too. */
function filled<T extends Module>(modules: readonly T[], codes: ReadonlyMap<string, string>): T[] {
  return modules.map((m) => (m.layers
    ? { ...m, layers: m.layers.map((s) => ({ ...s, modules: filled(s.modules, codes) })) }
    : { ...m, code: (m.ref && codes.get(m.ref)) || '' }));
}

/** `layers` as the engine plays them: every module's code from the library by ref. */
export function fromLibrary<L extends { modules: readonly Module[] }>(layers: readonly L[],
  codes: ReadonlyMap<string, string>): L[] {
  return layers.map((l) => ({ ...l, modules: filled(l.modules, codes) }));
}
