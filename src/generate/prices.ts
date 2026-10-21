// What a paid model's tokens cost, in US dollars per million, for the admins' view of how an idea was made
// (SPEC-generators "How it was made"). Claude's list prices; a cache write is billed as input here, so a cost is at
// most a few percent low. Codex runs on a subscription: no price, no dollars.

type Price = { input: number, cached: number, output: number };
/** By the provider's model name; the longest prefix that matches wins. */
const PRICES: Record<string, Price> = {
  'claude-fable-5': { input: 10, cached: 0.25, output: 50 },
  'claude-opus-5-5': { input: 4, cached: 0.2, output: 20 },
  'claude-opus-5': { input: 5, cached: 0.5, output: 25 },
  'claude-sonnet-5': { input: 2, cached: 0.2, output: 10 },
  'claude-haiku-5': { input: 0.1, cached: 0.01, output: 0.5 },
};

/** The dollars `tokens` cost on `model` (`input` counts the `cached`); undefined for a model with no price. */
export function costOf(model: string | undefined, tokens: { input?: number, cached?: number, output?: number }) {
  const key = Object.keys(PRICES).filter((k) => model?.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  if (!key) return undefined;
  const p = PRICES[key]!, cached = Number(tokens.cached) || 0;
  const fresh = Math.max(0, (Number(tokens.input) || 0) - cached);
  return (fresh * p.input + cached * p.cached + (Number(tokens.output) || 0) * p.output) / 1e6;
}
