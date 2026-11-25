// JSON-safe presentation hints; runtime parameter resolution deliberately ignores them (SPEC-library).
export type Conditions = Record<string, (string | boolean | number)[]>;
export type ParamControls = { showWhen?: Conditions };

function conditions(raw: unknown): Conditions | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const entries = Object.entries(raw);
  if (!entries.length || entries.length > 16) return;
  const out: Conditions = {};
  for (const [key, values] of entries) {
    if (!Array.isArray(values) || !values.length || values.length > 16 || !values.every((v) =>
      typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v))) return;
    out[key] = [...values];
  }
  return out;
}

export function paramControls(raw: Record<string, unknown>): ParamControls {
  const out: ParamControls = {}, showWhen = conditions(raw.showWhen);
  if (showWhen) out.showWhen = showWhen;
  return out;
}
