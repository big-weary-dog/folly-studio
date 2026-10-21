// npm run config:check -- <env file>: whether the server would start with these settings (src/config.ts). Prints OK,
// or the names of the settings that would stop it; then any it would warn of. Never a value: the file holds secrets.
// Exits 1 when the server would not start. `npm run host` runs it on the new build before it restarts the service.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { ConfigError, readConfig } from '../src/config.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run config:check -- <env file>');
  process.exit(2);
}
let text;
try {
  text = readFileSync(file, 'utf8');
} catch (err) {
  console.error(`config:check: cannot read ${file} (${(err as NodeJS.ErrnoException).code})`);
  process.exit(2);
}
const warned: string[] = [];
try {
  readConfig(parseEnv(text), { warned });
  console.log('OK');
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.log(`would not start; fix: ${err.names.join(' ')}`);
  process.exitCode = 1;
}
if (warned.length) console.log(`warned of: ${[...new Set(warned)].join(' ')}`);
