// Compare what Mirage received with what we sent, per pixel, matched by universe + channel, and
// check our LED map against the canonical TouchDesigner CSV (td/data/all-pixels-positions.csv).
import { readFileSync } from 'node:fs';

import { identity, led } from './looks.mjs';
import { REPO } from './stack.mjs';

const CPU = led.channelsPerUniverse;
const POS_TOLERANCE = 0.1; // metres: Mirage draws some fixtures at a centroid or offset from the strip
const absOf = (u, ch0) => (u - 1) * CPU + ch0;
const zoneGroup = (z) => (z.startsWith('rose-petal') ? 'rose-window (16 petals)' : z);

/** The canonical pixel CSV: [{ zone, id, universe, channel, pos: [x, y, z], row }], CSV order. */
export function loadCanonical() {
  const lines = readFileSync(`${REPO}td/data/all-pixels-positions.csv`, 'utf8').trim().split('\n');
  const head = lines.shift().split(',');
  const at = (name) => head.indexOf(name);
  return lines.map((l) => {
    const c = l.split(',');
    return { zone: c[at('zone')], id: +c[at('pixel_id')], universe: +c[at('universe')], channel: +c[at('channel')],
      pos: [+c[at('cat_x')], +c[at('cat_y')], +c[at('cat_z')]], row: +c[at('row')] || 0 };
  });
}

/** Our rig.json against the canonical CSV, row by row: zone, address and position. */
export function checkCanonical(csv = loadCanonical()) {
  const px = led.pixels;
  const diffs = [];
  let posMax = 0;
  for (let k = 0; k < led.count; k++) {
    const r = csv[k];
    if (!r) { diffs.push({ k, why: 'no CSV row' }); continue; }
    const zone = led.zones[px.zone[k]];
    const d = Math.hypot(...[0, 1, 2].map((i) => px.pos[3 * k + i] - r.pos[i]));
    posMax = Math.max(posMax, d);
    if (zone !== r.zone || px.universe[k] !== r.universe || px.channel[k] !== r.channel || d > 0.002) {
      diffs.push({ k, zone, csvZone: r.zone, ours: [px.universe[k], px.channel[k]], csv: [r.universe, r.channel], d });
    }
  }
  return { rows: csv.length, count: led.count, diffs, posMax };
}

const near = (store, i, k) => {
  const px = led.pixels;
  return Math.hypot(...[0, 1, 2].map((a) => store.pos[3 * i + a] - px.pos[3 * k + a]));
};

function nearestOurs(store, i) {
  let best = -1, bd = Infinity;
  for (let k = 0; k < led.count; k++) {
    const d = near(store, i, k);
    if (d < bd) { bd = d; best = k; }
  }
  return { k: best, d: bd };
}

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : 0);

/**
 * Per pixel, matched by universe + channel: did Mirage get the bytes we sent (`frame`, absolute
 * channels), are they the address look's identity, and is the pixel where ours is?
 */
export function compareAddresses(store, frame, { checkIdentity = true } = {}) {
  const px = led.pixels;
  const ours = new Map();
  const driven = new Uint8Array(frame.length);
  for (let k = 0; k < led.count; k++) {
    const a = absOf(px.universe[k], px.channel[k] - 1);
    ours.set(a, k);
    driven.fill(1, a, a + 3);
  }
  const zones = new Map(), mirageZones = new Map();
  const zoneRow = (name) => {
    if (!zones.has(name)) zones.set(name, { zone: name, ours: 0, matched: 0, bytesOk: 0, bytesBad: 0, posOff: 0,
      studioOnly: 0, dists: [] });
    return zones.get(name);
  };
  for (let k = 0; k < led.count; k++) zoneRow(zoneGroup(led.zones[px.zone[k]])).ours++;
  const seen = new Map(), problems = [], mirageOnly = [], duplicates = [];
  for (let i = 0; i < store.count; i++) {
    const mz = store.zoneKeys[store.zone[i]];
    if (!mirageZones.has(mz)) mirageZones.set(mz, { zone: mz, pixels: 0, matched: 0, mirageOnly: 0 });
    const mrow = mirageZones.get(mz);
    mrow.pixels++;
    const a = absOf(store.universe[i], store.ch0[i]);
    const got = [0, 1, 2].map((c) => Math.round(store.drive[3 * i + c] * 255));
    const at = { i, mirageZone: mz, universe: store.universe[i], channel: store.ch0[i] + 1, got };
    if (seen.has(a)) duplicates.push({ ...at, also: seen.get(a) });
    seen.set(a, i);
    const k = ours.get(a);
    if (k === undefined) {
      mrow.mirageOnly++;
      const overlaps = driven[a] || driven[a + 1] || driven[a + 2];
      const n = nearestOurs(store, i);
      mirageOnly.push({ ...at, overlaps: !!overlaps, nearest: { k: n.k, zone: led.zones[px.zone[n.k]],
        universe: px.universe[n.k], channel: px.channel[n.k], d: +n.d.toFixed(3) } });
      continue;
    }
    mrow.matched++;
    const row = zoneRow(zoneGroup(led.zones[px.zone[k]]));
    row.matched++;
    const sent = [frame[a], frame[a + 1], frame[a + 2]];
    const want = checkIdentity ? identity(k) : sent;
    const ok = got.every((v, c) => v === sent[c]) && sent.every((v, c) => v === want[c]);
    const d = near(store, i, k);
    row.dists.push(d);
    if (ok) row.bytesOk++;
    else row.bytesBad++;
    if (d > POS_TOLERANCE) row.posOff++;
    if (!ok || d > POS_TOLERANCE) {
      problems.push({ ...at, k, zone: led.zones[px.zone[k]], sent, want, bytesOk: ok, d: +d.toFixed(3) });
    }
  }
  const studioOnly = [];
  for (const [a, k] of ours) {
    if (seen.has(a)) continue;
    zoneRow(zoneGroup(led.zones[px.zone[k]])).studioOnly++;
    studioOnly.push({ k, zone: led.zones[px.zone[k]], universe: px.universe[k], channel: px.channel[k] });
  }
  const perZone = [...zones.values()].map(({ dists, ...r }) => ({ ...r,
    medianD: +median(dists).toFixed(3), maxD: +Math.max(0, ...dists).toFixed(3) }));
  return { perZone, mirageZones: [...mirageZones.values()], problems, mirageOnly, studioOnly, duplicates,
    mirageCount: store.count, ourCount: led.count };
}

/**
 * Moving looks: Mirage gets universes one packet at a time, so check each universe on its own:
 * do its pixels hold exactly one frame of the file? Returns { universes, exact, frames: Set }.
 */
export function framesPerUniverse(store, channels, frameCount, full) {
  const byU = new Map();
  for (let i = 0; i < store.count; i++) {
    const u = store.universe[i];
    if (!byU.has(u)) byU.set(u, []);
    byU.get(u).push(i);
  }
  let exact = 0;
  const frames = new Set(), misses = [];
  for (const [u, pixels] of byU) {
    let found = -1;
    for (let f = 0; f < frameCount && found < 0; f++) {
      const base = f * full;
      const all = pixels.every((i) => [0, 1, 2].every((c) => Math.round(store.drive[3 * i + c] * 255)
        === channels[base + absOf(u, store.ch0[i]) + c]));
      if (all) found = f;
    }
    if (found >= 0) { exact++; frames.add(found); } else misses.push(u);
  }
  return { universes: byU.size, exact, frames: [...frames].sort((a, b) => a - b), misses };
}

const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

export function addressMarkdown(r) {
  const out = [];
  out.push(table(['zone (ours)', 'LEDs', 'matched by u+ch', 'bytes ok', 'bytes bad', 'pos > 0.1 m',
    'median / max Δpos (m)', 'only in Studio'],
  r.perZone.map((z) => [z.zone, z.ours, z.matched, z.bytesOk, z.bytesBad, z.posOff, `${z.medianD} / ${z.maxD}`,
    z.studioOnly])));
  out.push('', table(['Mirage zone', 'pixels', 'matched', 'only in Mirage'],
    r.mirageZones.map((z) => [z.zone, z.pixels, z.matched, z.mirageOnly])));
  const sum = (key) => r.perZone.reduce((n, z) => n + z[key], 0);
  out.push('', `Totals: Studio ${r.ourCount} LEDs, Mirage ${r.mirageCount} pixels; matched ${sum('matched')}, `
    + `bytes ok ${sum('bytesOk')}, bytes bad ${sum('bytesBad')}, position > ${POS_TOLERANCE} m ${sum('posOff')}, `
    + `only in Studio ${r.studioOnly.length}, only in Mirage ${r.mirageOnly.length}, `
    + `duplicate Mirage addresses ${r.duplicates.length}.`);
  return out.join('\n');
}

export function listMarkdown(title, rows, fmt, limit = 25) {
  if (!rows.length) return `${title}: none.`;
  const more = rows.length > limit ? `\n- … and ${rows.length - limit} more` : '';
  return `${title} (${rows.length}):\n${rows.slice(0, limit).map((x) => `- ${fmt(x)}`).join('\n')}${more}`;
}

/**
 * The documented quirks (mirage/README.md "Notes"), checked against the data: where mini arch 5
 * starts, the main-arch pixel count, and the canopy sag Mirage draws (`sag`, metres, from its config).
 */
export function quirksMarkdown(r, { sag } = {}) {
  const px = led.pixels;
  const umap = JSON.parse(readFileSync(`${REPO}pixel-map/universe-map.json`, 'utf8')).zones;
  const bad = new Set([...r.problems.filter((x) => !x.bytesOk).map((x) => x.k), ...r.studioOnly.map((x) => x.k)]);
  const lines = ['## The documented quirks, checked', ''];
  for (const side of ['left', 'right']) {
    const i = led.strands.findIndex((s) => s.name === `Mini arch ${side} 5`);
    const s = led.strands[i];
    const map = umap[`arches_mini_${side}`].universes_detail.find((d) => d.arch_id === 5 && d.start_ch !== 1);
    let ok = 0;
    for (let k = s.start; k < s.start + s.count; k++) if (!bad.has(k)) ok++;
    lines.push(`- Mini arch ${side} 5: Studio starts it at u${px.universe[s.start]} ch${px.channel[s.start]} `
      + `and ends at u${px.universe[s.start + s.count - 1]} ch${px.channel[s.start + s.count - 1]}; `
      + `universe-map.json says u${map?.universe} ch${map?.start_ch}. Mirage reads all ${ok}/${s.count} of its `
      + 'pixels at our addresses. cathedral-3d-sim.html reads it from ch 1, so it repeats arch 1 (magenta '
      + 'arch 5 shows orange there).');
  }
  const arches = led.strands.filter((s) => s.name.startsWith('Main arch '));
  const total = arches.reduce((n, s) => n + s.count, 0);
  lines.push(`- Main arches: Studio, Mirage and td/data/all-pixels-positions.csv have ${total} `
    + `(${arches.map((s) => s.count).join('/')}), from arch-led-positions.json; universe-map.json's totals say `
    + `${umap.arches.totals.total_pixels} (counts_provisional: ${umap.arches.totals.counts_provisional}). Each arch `
    + `starts its own universe pair (${arches.map((s) => `u${px.universe[s.start]} ch${px.channel[s.start]}`)
      .join(', ')}), so the difference moves no other arch: the stale side is universe-map.json's totals.`);
  const canopy = r.perZone.find((z) => z.zone === 'canopy');
  if (canopy) {
    lines.push(`- Canopy: bytes ${canopy.bytesOk}/${canopy.ours} exact, but ${canopy.posOff} pixels sit more than `
      + `0.1 m from ours (max ${canopy.maxD} m). Mirage lowers each run by its FIXTURES.canopy.sag = ${sag} m × `
      + '4t(1 − t) (zones/canopy.js), a drawing choice; the pixel map, the CSV and Studio keep the straight cable.');
  }
  const rose = r.perZone.find((z) => z.zone.startsWith('rose-window'));
  if (rose) {
    lines.push(`- Rose window: bytes ${rose.bytesOk}/${rose.ours} exact; positions within ${rose.maxD} m (Mirage `
      + 'puts each cell at its polygon\'s centroid).');
  }
  return lines.join('\n');
}
