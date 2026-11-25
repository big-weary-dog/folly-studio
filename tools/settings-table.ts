// npm run docs:settings: writes docs/HOSTING.md "Every setting"'s table from src/config.ts's SETTINGS, between its
// markers, so the settings are listed in one place. test/settings-table.test.ts fails while the committed one differs.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SETTINGS } from '../src/config.ts';

export const HOSTING = fileURLToPath(new URL('../docs/HOSTING.md', import.meta.url));
const START = '<!-- settings: npm run docs:settings writes this table from src/config.ts -->';
const END = '<!-- /settings -->';

/** The settings table, one row a setting in SETTINGS' order. */
export function settingsTable(): string {
  const cell = (s: string) => s.replaceAll('|', '\\|');
  return ['| Setting | What it is |', '| --- | --- |',
    ...SETTINGS.map(({ name, about }) => `| \`${name}\` | ${cell(about)} |`)].join('\n');
}

/** `md` with the table between its markers replaced by `settingsTable()`; throws when a marker is missing. */
export function withSettingsTable(md: string): string {
  const a = md.indexOf(START), b = md.indexOf(END);
  if (a < 0 || b < a) throw new Error(`docs/HOSTING.md needs ${START} and then ${END}`);
  return `${md.slice(0, a + START.length)}\n${settingsTable()}\n${md.slice(b)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const md = readFileSync(HOSTING, 'utf8'), next = withSettingsTable(md);
  if (next !== md) writeFileSync(HOSTING, next);
  console.log(`docs/HOSTING.md: the settings table ${next === md ? 'is current' : 'written'}`);
}
