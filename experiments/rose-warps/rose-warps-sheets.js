// Lay out the actual Studio captures, preserving originals beside the report.
import { readFileSync } from 'node:fs';

import sharp from 'sharp';

import { candidates, reportDir } from './rose-warps-cases.js';

const captures = JSON.parse(readFileSync(`${reportDir}/captures.json`, 'utf8'));
const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const label = (text, width, height) => Buffer.from(`<svg width="${width}" height="${height}">
<rect width="100%" height="100%" fill="#13151e"/><text x="12" y="24" fill="#eceaf5"
font-family="sans-serif" font-size="14">${esc(text)}</text></svg>`);
const W = 341, H = 300, L = 38;
async function tile(c, text) {
  const b = c.box;
  const side = Math.floor(Math.min(b.width, b.height) * 0.85);
  const picture = await sharp(`${reportDir}/images/${c.file}`).extract({
    left: Math.round(b.x + (b.width - side) / 2),
    top: Math.round(b.y + Math.min(b.height - side, (b.height - side) / 2 + 20)), width: side, height: side,
  }).resize(W, H, { fit: 'contain', background: '#05060c' }).png().toBuffer();
  return sharp({ create: { width: W, height: H + L, channels: 3, background: '#13151e' } })
    .composite([{ input: picture, top: 0, left: 0 }, { input: label(text, W, L), top: H, left: 0 }]).png().toBuffer();
}
for (const c of candidates) {
  const tiles = [];
  for (const [row, source] of ['bars', 'clouds'].entries()) {
    const picks = [captures.find((x) => x.file === `baseline-${source}.png`),
      ...[1, 2, 3].map((n) => captures.find((x) => x.file === `${c.name}-${source}-${n}.png`))];
    for (const [col, p] of picks.entries()) tiles.push({ input: await tile(p,
      `${source} / ${col ? `setting ${col}` : 'unwarped'}`), left: col * W, top: row * (H + L) });
  }
  await sharp({ create: { width: W * 4, height: (H + L) * 2, channels: 3, background: '#05060c' } })
    .composite(tiles).png().toFile(`${reportDir}/images/${c.name}-comparison.png`);
}
for (const name of [...candidates.map((c) => c.name), 'baseline']) {
  const tiles = [];
  for (let f = 0; f < 4; f++) {
    const c = captures.find((x) => x.file === `${name}-motion-f${f}.png`);
    tiles.push({ input: await tile(c, `${name} / ${c.time.toFixed(1)} s`), left: f * W, top: 0 });
  }
  await sharp({ create: { width: W * 4, height: H + L, channels: 3, background: '#05060c' } })
    .composite(tiles).png().toFile(`${reportDir}/images/${name}-strip.png`);
}
const tiles = [];
for (const [i, rule] of ['alternate', 'wedges', 'ring', 'checker'].entries()) {
  const c = captures.find((x) => x.file === `subsets-${rule}.png`);
  tiles.push({ input: await tile(c, `Bars + Clouds / ${rule}`), left: i % 2 * W, top: Math.floor(i / 2) * (H + L) });
}
await sharp({ create: { width: W * 2, height: (H + L) * 2, channels: 3, background: '#05060c' } })
  .composite(tiles).png().toFile(`${reportDir}/images/subsets-comparison.png`);
console.log(`Wrote ${candidates.length} comparisons, ${candidates.length + 1} strips, subset sheet.`);
const cells = [];
for (let ring = 1; ring <= 7; ring++) for (let petal = 0; petal < 16; petal++) {
  const a = petal % 3 === 0 && ring >= 2 && ring <= 6;
  cells.push(`<rect x="${82 + petal * 42}" y="${72 + (ring - 1) * 42}" width="36" height="34"
    rx="5" fill="${a ? '#f33183' : '#03a4b8'}"/><text x="${94 + petal * 42}" y="${95 + (ring - 1) * 42}"
    fill="white" font-size="14">${a ? 'A' : 'B'}</text>`);
}
const diagram = `<svg width="790" height="420" xmlns="http://www.w3.org/2000/svg">
<rect width="790" height="420" fill="#13151e"/><g font-family="sans-serif" fill="#eceaf5">
<text x="22" y="28" font-size="18">Proposed saved selection: every third petal AND rings 2–6</text>
${Array.from({ length: 16 }, (_, p) => `<text x="${92 + p * 42}" y="60">${p}</text>`).join('')}
${Array.from({ length: 7 }, (_, r) => `<text x="18" y="${95 + r * 42}">Ring ${r + 1}</text>`).join('')}
${cells.join('')}<text x="22" y="392" font-size="16">A: Bars · B: Clouds · one linked selection + complement</text>
</g></svg>`;
await sharp(Buffer.from(diagram)).png().toFile(`${reportDir}/images/selection-proposal.png`);
