// Report-only rose warp fixtures; no catalogue entries or production presets.
import { readFileSync } from 'node:fs';

export const reportDir = `${process.env.HOME}/.fleet/folly-studio/reports/rose-warps`;
export const code = (name) => readFileSync(new URL(name.startsWith('rose-')
  ? `patterns/${name}.js` : `../../public/patterns/${name}.js`, import.meta.url), 'utf8');
export const candidates = [
  { name: 'rose-ring-turn', settings: [{ step: 1 }, { step: 2 }, { step: 1, alternate: true }],
    motion: { step: 1, speed: 1 } },
  { name: 'rose-fold', settings: [{ repeats: 'four' }, { repeats: 'eight' }, { repeats: 'two', offset: 3 }],
    motion: {} },
  { name: 'rose-kaleido', settings: [{ petal: 0 }, { petal: 3 }, { petal: 7, mirror: false }],
    motion: { petal: 0, speed: 1 } },
  { name: 'rose-stride', settings: [{ stride: 's3' }, { stride: 's5' }, { stride: 's7', offset: 2 }], motion: {} },
  { name: 'rose-shift', settings: [{ offset: 2 }, { offset: 1, swap: true }, { offset: 4, swap: true }],
    motion: { offset: 0, speed: 2 } },
  { name: 'rose-ring-reverse', settings: [{ inner: 1, outer: 7 }, { inner: 2, outer: 6 },
    { inner: 4, outer: 7 }], motion: {} },
  { name: 'rose-spiral', settings: [{ stride: 's1', offset: 8 }, { stride: 's3', offset: 1 },
    { stride: 's5', offset: 16 }], motion: { stride: 's1', offset: 0, speed: 8 } },
];
export const sources = ['bars', 'clouds'];
export const sourceParams = {
  bars: { direction: 'right', bars: 5, speed: 0.4, profile: 'smooth',
    colours: '#5922c9 #03c9e8 #ffc04a #f33183' },
  clouds: { size: 0.45, cover: 0.85, speed: 0.15,
    colours: { pick: '#120b48 #5430bf #fa429b #ffd68c', blend: 'smooth' } },
};
export const look = (source, warp, params = {}) => ({
  title: `${warp || 'Unwarped'} / ${source} / ${JSON.stringify(params)}`, duration: 12, chain: 2,
  layers: [{ id: 'rose', title: 'Rose structure study', tags: ['rose'], level: 1, blend: 'over', modules: [
    { id: 'source', kind: 'source', title: source, code: code(source), params: sourceParams[source] },
    ...(warp ? [{ id: 'warp', kind: 'warp', title: warp, code: code(warp), params }] : []),
  ] }],
});

export const splitLook = (rule, size = 2, pick = 'even', index = 0) => ({
  title: `Two patterns / ${rule} / size ${size}`, duration: 12, chain: 2,
  layers: ['bars', 'clouds'].map((source, i) => ({
    id: `part-${i}`, title: i ? 'Clouds on the rest' : 'Bars on selected panes',
    tags: ['rose'], level: 1, blend: 'over', modules: [
      { id: 'source', kind: 'source', title: source, code: code(source), params: sourceParams[source] },
      { id: 'mask', kind: 'filter', title: 'Complementary region mask', code: code('mask'),
        params: { by: 'region', rule, size, pick, index, invert: !!i, softness: 0.01 } },
    ],
  })),
});
