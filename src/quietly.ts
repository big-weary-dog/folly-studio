// Node's ExperimentalWarning for type stripping and zstd, kept out of the logs.

/** fn() without Node's ExperimentalWarning about `feature` (Node warns once, on first use). */
export function quietly<T>(feature: RegExp, fn: () => T): T {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: [{ type?: string } | string | undefined]) => {
    const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type ?? (warning as Error).name;
    if (type === 'ExperimentalWarning' && feature.test(String((warning as Error).message ?? warning))) return;
    return emit.apply(process, [warning, ...rest] as Parameters<typeof emit>);
  }) as typeof emit;
  try { return fn(); } finally { process.emitWarning = emit; }
}
