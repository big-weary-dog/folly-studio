// The library docs an idea's turn carries whole (SPEC-generators "Library docs"): the pages its drafts named (Explore,
// Deep) or its look uses (a refinement). The READMEs stay out: the system prompt says what they do. Every call of the
// idea (compose, repair, critique) sends the same pages again, so the model reads none of them with read_doc, which
// stays for a page not given.

import { docCandidates } from './doc-path.ts';

export const MAX_GIVEN = 18;

/** The pages `asked` names (lenient, as read_doc takes them), found in the tree, once each, at most MAX_GIVEN. */
export function pickDocs(tree: ReadonlyMap<string, string>, asked: readonly unknown[] = []) {
  const found = asked.slice(0, 40).map((raw) => docCandidates(raw).find((p) => tree.has(p)));
  return [...new Set(found.filter((p): p is string => !!p && tree.has(p)))].slice(0, MAX_GIVEN);
}

/** The docs section heading a turn: each page in a <doc>; '' when none. */
export function docsBlock(tree: ReadonlyMap<string, string>, given: readonly string[] = []) {
  const pages = given.filter((p) => tree.has(p));
  if (!pages.length) return '';
  return `The library docs for this idea (read_doc only for a page not here):\n\n${pages.map((p) => `<doc path="${p}">
${tree.get(p)!.trim()}\n</doc>`).join('\n\n')}\n\n`;
}

/** read_doc's answer for a page the turn already carries: no read, no text again. */
export const givenAnswer = (path: string) => `${path} is in the turn already, in its <doc>: read it there.`;
