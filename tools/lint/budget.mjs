// The line-count ratchet: each area's lines of code (js, mjs, css, html, py) against
// tools/lint/budget.json. An area over its budget fails. A budget may go up only with a new
// `reason` beside it (compared with the committed file), so growth is a decision, never drift.

export const BUDGET_FILE = 'tools/lint/budget.json';

/** The area a file counts toward: its top folder, or public/<folder>; '.' for files at the root. */
export function areaOf(rel) {
  const p = rel.split('/');
  return p.length < 2 ? '.' : p[0] === 'public' && p.length > 2 ? `public/${p[1]}` : p[0];
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null; // the json rule reports a broken file
  }
};

/**
 * checkBudget(text, committedText, counts: Map<area, lines>, report(line, message)) → notes: areas well
 * under budget, whose budget should come down. Either text may be '' (no such file).
 */
export function checkBudget(text, committedText, counts, report) {
  const areas = parse(text)?.areas;
  const committed = parse(committedText)?.areas || {};
  if (!areas) {
    if (!text && Object.keys(committed).length) report(1, 'the committed budget is gone: restore it');
    return [];
  }
  const lineOf = (area) => {
    const at = text.indexOf(`"${area}"`);
    return at < 0 ? 1 : text.slice(0, at).split('\n').length;
  };
  const notes = [];
  for (const [area, lines] of [...counts].sort()) {
    const b = areas[area];
    if (!b) {
      report(1, `${area} has ${lines} lines of code and no budget`);
      continue;
    }
    if (lines > b.lines) {
      report(lineOf(area), `${area} has ${lines} lines, over its budget of ${b.lines}: cut, or raise it with a reason`);
    }
    const was = committed[area];
    if (was && b.lines > was.lines && (!b.reason || b.reason === was.reason)) {
      report(lineOf(area), `${area}'s budget went up from ${was.lines} without a new reason`);
    }
    if (lines < b.lines * 0.94) notes.push(`${area} is at ${lines} of ${b.lines} lines: lower its budget`);
  }
  return notes;
}
