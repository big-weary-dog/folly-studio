#!/usr/bin/env node
// npm run e2e: proves our .fseq output is what the real sculpture's input expects, against the
// independent simulators. Renders looks with pattern-core.js, writes them with fseq.js, plays them
// with tools/sacn-play.mjs as E1.31 through relay/relay.js into Mirage, then compares Mirage's
// pixel store with our bytes per pixel, matched by universe + channel. Not part of `npm test`.
//
//   E2E_DEPS=<folder with node_modules/three@0.160.0>  E2E_OUT=<folder for screenshots and findings>
//   needs: relay/node_modules (cd relay && npm install), python3, Playwright in `npm root -g`
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseFseq } from '../../src/frames.js';
import { compressFseq } from '../../src/fseq-codec.js';
import { readShow } from '../../tools/sacn-play.mjs';
import {
  addressMarkdown, checkCanonical, compareAddresses, framesPerUniverse, listMarkdown, quirksMarkdown,
} from './compare.mjs';
import { ADDRESS_CODE, cathedral, FULL, libraryCode, renderLook, toFseq, ZONE_CODE, ZONE_LABELS } from './looks.mjs';
import {
  launch, loadPlaywright, newContext, openMirage, showView, threeDir, viewFrom, waitForDrive,
} from './mirage.mjs';
import { Stack } from './stack.mjs';

const OUT = path.resolve(process.env.E2E_OUT || path.join(os.tmpdir(), 'folly-studio-e2e'));
const HTTP_PORT = Number(process.env.E2E_HTTP_PORT || 8765);
const MOVING = process.env.E2E_PATTERN || 'plasma';
const log = (m) => console.log(`e2e: ${m}`);
const file = (name, bytes) => {
  const p = path.join(OUT, name);
  writeFileSync(p, bytes);
  return p;
};

/** Fraction of Mirage's pixels whose drive is exactly the frame's bytes at their own address. */
function sameBytes(s, frame) {
  let ok = 0;
  for (let i = 0; i < s.count; i++) {
    const a = (s.universe[i] - 1) * cathedral.channelsPerUniverse + s.ch0[i];
    if ([0, 1, 2].every((c) => Math.round(s.drive[3 * i + c] * 255) === frame[a + c])) ok++;
  }
  return ok / s.count;
}

/** The player reads every FSEQ form to the same absolute channels as the frames we rendered. */
async function playerForms(rendered) {
  const sparse = toFseq(rendered, { sparse: true });
  const forms = { full: toFseq(rendered), sparse, zlib: await compressFseq(parseFseq(sparse), { codec: 'zlib' }) };
  try {
    forms.zstd = await compressFseq(parseFseq(sparse), { codec: 'zstd' });
  } catch { /* no zstd in this Node */ }
  const used = new Set();
  const px = cathedral.pixels;
  for (let k = 0; k < cathedral.count; k++) {
    const a = (px.universe[k] - 1) * 510 + px.channel[k] - 1;
    used.add(a).add(a + 1).add(a + 2);
  }
  const rows = [];
  for (const [name, bytes] of Object.entries(forms)) {
    const show = readShow(bytes);
    let bad = 0;
    for (let f = 0; f < rendered.frames; f++) {
      const got = show.frame(f);
      for (const a of used) if (got[a] !== rendered.channels[f * FULL + a]) bad++;
    }
    rows.push(`| ${name} | ${bytes.length} | ${show.frames} | ${show.fps} | ${bad} |`);
  }
  return ['| form | bytes | frames | fps | LED bytes differing |', '|---|---|---|---|---|', ...rows].join('\n');
}

async function shoot(page, name, view) {
  if (view) await showView(page, view);
  const p = path.join(OUT, name);
  await page.screenshot({ path: p, timeout: 180000 }); // SwiftShader reads back an HDR frame slowly
  log(`screenshot ${p}`);
  return p;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const md = ['# Folly Studio → sACN → relay → Mirage: end-to-end findings', '',
    `Run ${new Date().toISOString()}. Output in \`${OUT}\`.`, ''];

  const canon = checkCanonical();
  md.push('## Studio LED map vs the canonical TouchDesigner CSV', '',
    `cathedral.json ${canon.count} LEDs, td/data/all-pixels-positions.csv ${canon.rows} rows: `
    + `${canon.diffs.length} differ in zone, universe/channel or position `
    + `(max Δpos ${canon.posMax.toFixed(4)} m).`, '');

  log('rendering looks with pattern-core.js');
  const address = renderLook([{ code: ADDRESS_CODE }]);
  const zones = renderLook([{ code: ZONE_CODE }]);
  const moving = renderLook([{ code: libraryCode(MOVING) }], { seconds: 6 });
  const files = {
    address: file('address.fseq', toFseq(address)),
    zones: file('zones.fseq', toFseq(zones, { sparse: true })),
    moving: file(`${MOVING}.fseq`, await compressFseq(parseFseq(toFseq(moving, { sparse: true })))),
  };
  md.push('## The player reads every FSEQ form the same', '', await playerForms(moving), '');

  const { chromium } = loadPlaywright();
  const stack = new Stack({ httpPort: HTTP_PORT, log });
  let browser;
  const shots = [];
  try {
    await stack.up();
    browser = await launch(chromium);
    const context = await newContext(browser, threeDir());
    const page = await context.newPage();
    const errors = await openMirage(page, `http://localhost:${HTTP_PORT}/mirage/`);
    log('Mirage is up');

    await stack.play(files.address, ['--hold', '0', '--loop']);
    let store = await waitForDrive(page, (s) => sameBytes(s, address.channels) > 0.999);
    const r = compareAddresses(store, address.channels);
    writeFileSync(path.join(OUT, 'address-compare.json'), JSON.stringify(r, null, 1));
    md.push('## Address test: per pixel, matched by universe + channel', '',
      'Look: R = k mod 251, G = zone × 7 mod 251, B = strand × 13 mod 251 (bytes), held on frame 0 by '
      + '`sacn-play --hold 0 --loop`. "bytes ok" means Mirage\'s drive × 255 equals the byte we sent, and that '
      + 'byte is the LED\'s identity. Δpos is Mirage\'s pixel position against ours for the same address.', '',
      addressMarkdown(r), '',
      listMarkdown('Matched pixels with wrong bytes', r.problems.filter((x) => !x.bytesOk), (x) => `${x.zone} `
        + `k${x.k} u${x.universe} ch${x.channel}: Mirage ${x.mirageZone} got [${x.got}], sent [${x.sent}], `
        + `want [${x.want}], Δpos ${x.d} m`), '',
      listMarkdown('Matched pixels with the right bytes but more than 0.1 m from ours', r.problems
        .filter((x) => x.bytesOk), (x) => `${x.zone} k${x.k} u${x.universe} ch${x.channel}: Δpos ${x.d} m`, 5), '',
      listMarkdown('Mirage pixels at an address we do not drive', r.mirageOnly, (x) => `${x.mirageZone} `
        + `u${x.universe} ch${x.channel} got [${x.got}]${x.overlaps ? ' (overlaps a channel we drive)' : ''}; `
        + `nearest of ours: ${x.nearest.zone} k${x.nearest.k} u${x.nearest.universe} ch${x.nearest.channel} `
        + `${x.nearest.d} m away`), '',
      listMarkdown('Our LEDs no Mirage pixel reads', r.studioOnly, (x) => `${x.zone} k${x.k} u${x.universe} `
        + `ch${x.channel}`), '',
      listMarkdown('Mirage pixels sharing an address', r.duplicates, (x) => `${x.mirageZone} u${x.universe} `
        + `ch${x.channel} (pixels ${x.also} and ${x.i})`), '');
    const sag = await page.evaluate(async () => (await import(new URL('src/config.js', location.href).href))
      .FIXTURES?.canopy?.sag);
    md.push(quirksMarkdown(r, { sag }), '');
    shots.push(await shoot(page, 'mirage-address-front.png', viewFrom(cathedral.views.front)));

    await stack.play(files.zones, ['--hold', '0', '--loop']);
    store = await waitForDrive(page, (s) => sameBytes(s, zones.channels) > 0.999);
    md.push('## Zone colours', '', `${ZONE_LABELS.join('; ')}.`,
      `Mirage pixels holding exactly our bytes: ${(sameBytes(store, zones.channels) * 100).toFixed(2)} %.`, '');
    shots.push(await shoot(page, 'mirage-zones-front.png', viewFrom(cathedral.views.front)));
    shots.push(await shoot(page, 'mirage-zones-rose.png', viewFrom(cathedral.views.rose)));
    const nave = await page.evaluate(async () => (await import(new URL('src/config.js', location.href).href)).VIEWS
      .find((v) => v.label === 'In the nave'));
    if (nave) shots.push(await shoot(page, 'mirage-zones-nave.png', nave));

    await stack.play(files.moving, ['--loop']);
    await page.waitForTimeout(3000);
    const motion = [];
    for (const view of ['front', 'rose']) {
      store = await waitForDrive(page, () => true, { timeout: 5000 });
      motion.push(framesPerUniverse(store, moving.channels, moving.frames, FULL));
      shots.push(await shoot(page, `mirage-${MOVING}-${view}.png`, viewFrom(cathedral.views[view])));
    }
    md.push(`## Moving library pattern: ${MOVING} (6 s, sparse + compressed .fseq, --loop)`, '',
      'Universes arrive one packet at a time, so each universe is checked on its own: do its pixels in Mirage '
      + 'hold exactly one frame of the file?', '',
      ...motion.map((m, i) => `- read ${i + 1}: ${m.exact}/${m.universes} universes hold an exact frame `
        + `(frames ${m.frames.join(', ')})${m.misses.length ? `; not exact: u${m.misses.join(', u')}` : ''}`), '');

    await page.close(); // one SwiftShader scene at a time
    await stack.play(files.zones, ['--hold', '0', '--loop']);
    const old = await context.newPage();
    const oldErrors = [];
    old.on('pageerror', (e) => oldErrors.push(String(e)));
    await old.goto(`http://localhost:${HTTP_PORT}/cathedral-3d-sim.html`, { waitUntil: 'commit', timeout: 120000 });
    await old.waitForTimeout(20000);
    shots.push(await shoot(old, 'old-sim-zones.png'));
    md.push('## cathedral-3d-sim.html (older sim), zone colours', '',
      `Opened once with the zone look held; page errors: ${oldErrors.length ? oldErrors.join('; ') : 'none'}. `
      + 'See old-sim-zones.png.', '');
    md.push('## Console errors in Mirage', '', errors.length ? errors.map((e) => `- ${e}`).join('\n') : 'None.', '');
  } finally {
    await browser?.close();
    await stack.down();
  }
  md.push('## Screenshots', '', ...shots.map((s) => `- ${s}`), '');
  const report = path.join(OUT, 'run.md');
  writeFileSync(report, md.join('\n'));
  log(`findings: ${report}`);
}

await main();
