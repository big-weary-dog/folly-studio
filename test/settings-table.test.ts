// docs/HOSTING.md "Every setting" is written from src/config.ts (tools/settings-table.ts), never by hand.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { test } from 'vitest';

import { SETTINGS } from '../src/config.ts';
import { HOSTING, settingsTable, withSettingsTable } from '../tools/settings-table.ts';

test('the committed settings table is the one src/config.ts gives (npm run docs:settings writes it)', () => {
  const md = readFileSync(HOSTING, 'utf8');
  assert.equal(md, withSettingsTable(md), 'docs/HOSTING.md\'s settings table is stale: run npm run docs:settings');
  for (const { name } of SETTINGS) assert.ok(settingsTable().includes(`| \`${name}\` |`), name);
  assert.throws(() => withSettingsTable('no markers'), /needs/);
});
