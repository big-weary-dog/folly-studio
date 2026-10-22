// Custom code off (SPEC-baking "Custom code"): a prompted model is told to compose from the library alone, and its
// rounds' expand refuses new code (catalog.allows), so a repair round sees why. The look saved is checked again.
import type { CodeGate } from '../custom-code.ts';
import type { Catalog } from './catalog.ts';
import type { Context } from './index.ts';
import { buildUserMessage } from './prompt.ts';

export type { CodeGate };

const NOTE = 'This server takes no new code: compose from the library alone, with no extensions and no code.';

/** The catalog for this idea's rounds; while custom code is off, held to code its owner may save, and the turn told. */
export async function libraryOnly(ctx: Context, catalog: Catalog | undefined,
  gate?: Pick<CodeGate, 'open' | 'allows'>) {
  if (!catalog || !gate || gate.open()) return catalog;
  if (!ctx.turn?.includes(NOTE)) ctx.turn = `${ctx.turn ?? buildUserMessage(ctx.text)}\n\n${NOTE}`;
  return { ...catalog, allows: await gate.allows(ctx.user.id) };
}
