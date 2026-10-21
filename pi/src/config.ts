// The Pi's settings: defaults, then pi/config.json (the Pi's own, gitignored, so git pull never touches it), then the
// command line. `npm run pi -- --help` lists them.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { COG_POWER } from './power.ts';

export const DEFAULTS = {
  dryRun: false,            // render and limit as live, send nothing; print the stats line
  host: '127.0.0.1',        // fppd's DDP bridge
  port: 4048,
  http: 4043,               // the control page (0: none)
  bind: '0.0.0.0',
  base: '',                 // the page's path ('' = at /; '/pi' behind Studio's proxy, docs/HOSTING.md)
  pin: '',                  // a PIN the control page asks for before it changes anything ('' = none)
  looks: '',                // a folder of looks besides pi/looks and pi/local/looks
  look: 'heartbeat-plasma', // played at start
  safe: 'safe',             // where the flash guard dips to, and a look that cannot play falls back to
  light: 'light.json',      // the light settings (Studio's Light page), relative to pi/; missing: the defaults
  frames: '',               // Studio's baked frames (<STUDIO_DATA>/frames), relative to pi/ ('' = it plays no bakes)
  cap: COG_POWER.cap, headroom: COG_POWER.headroom, gen: COG_POWER.gen,
  stats: 0,                 // seconds between stats lines (0: 5 in a dry run, 60 live)
  seconds: 0,               // stop after this long (0: run until stopped)
};
export type Config = typeof DEFAULTS;

const HELP = `npm run pi -- [options]   (the Pi's live engine: looks to the lights over DDP, and the control page)
  --dry-run          send nothing: print a stats line instead
  --host H --port P  where DDP goes (${DEFAULTS.host}:${DEFAULTS.port}, fppd)
  --http P           the control page's port (${DEFAULTS.http}; 0 for none); --bind A its address (${DEFAULTS.bind})
  --base /PATH       serve the page under /PATH/ rather than at /
  --pin N            ask for this PIN before the page changes anything
  --looks DIR        play looks from DIR too (beside pi/looks and pi/local/looks)
  --look ID          the look to start on (${DEFAULTS.look}); --safe ID the flash guard's (${DEFAULTS.safe})
  --light FILE       the light settings: gamma, balance… (pi/${DEFAULTS.light}, from Studio's Light page)
  --frames DIR       Studio's baked frames (its <STUDIO_DATA>/frames), so it can play looks' bakes
  --cap C --headroom H --gen W
                     the power compressor (compress-fseq's: ${COG_POWER.cap}, ${COG_POWER.headroom}, ${COG_POWER.gen})
  --stats S          seconds between stats lines; --seconds S stop after S seconds
  --config FILE      settings as JSON (default pi/config.json, if there)`;

/** Settings from defaults, the config file and argv; null after printing help. */
export function readConfig(argv: string[], configFile: string): Config | null {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, config: { type: 'string' },
    ...Object.fromEntries(['host', 'port', 'http', 'bind', 'base', 'pin', 'looks', 'look', 'safe', 'light', 'frames',
      'cap', 'headroom', 'gen', 'stats', 'seconds'].map((k) => [k, { type: 'string' as const }])),
  } });
  if (values.help) { console.log(HELP); return null; }
  let file: Partial<Config> = {};
  const path = (values.config as string | undefined) ?? configFile;
  try { file = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    if (values.config || (e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`${path}: ${(e as Error).message}`, { cause: e });
    }
  }
  const cfg: Config = { ...DEFAULTS };
  for (const [k, d] of Object.entries(DEFAULTS) as [keyof Config, unknown][]) {
    const flag = k === 'dryRun' ? values['dry-run'] : (values as Record<string, unknown>)[k];
    const v = flag ?? file[k];
    if (v === undefined) continue;
    const n = typeof d === 'number' ? Number(v) : typeof d === 'boolean' ? v === true || v === 'true' : String(v);
    if (typeof n === 'number' && !Number.isFinite(n)) throw new Error(`${k} must be a number`);
    (cfg as Record<string, unknown>)[k] = n;
  }
  if (cfg.base && !/^(\/[a-z0-9-]+)+$/.test(cfg.base)) throw new Error('base must be like /pi');
  if (!cfg.stats) cfg.stats = cfg.dryRun ? 5 : 60;
  return cfg;
}
