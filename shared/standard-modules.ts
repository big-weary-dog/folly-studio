// Standard modules (SPEC "Modules"): a module whose `ref` names a library module is that module, and keeps the
// library's name; any other (written by the AI, or edited in the code editor, which drops the ref) is custom, and its
// own to name. The one test the chain, the store and the server share.
type Entry = { name: string, title?: string, kind?: string };
type Named = { ref?: string, title: string };

/** The name a standard module carries (its library entry's), or undefined when the module is custom. */
export function standardTitle(m: { ref?: string }, library: readonly Entry[]): string | undefined {
  const e = m.ref ? library.find((x) => x.name === m.ref && x.kind !== 'preset') : undefined;
  return e && (e.title || e.name);
}

/** Modules with each standard one named as the library names it: renaming a standard module never sticks. */
export function keepStandardTitles<M extends Named>(mods: M[], library: readonly Entry[]): M[] {
  return mods.map((m) => {
    const title = standardTitle(m, library);
    return title === undefined || title === m.title ? m : { ...m, title };
  });
}
