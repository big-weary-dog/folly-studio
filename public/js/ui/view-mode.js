// Over the 3D view: Playa (Mirage's night playa) or Points (the lightest), and the Playa's quality: Auto (by
// device, then stepping down while frames are slow), Full, Lite or Low.
import { h, pref, stylesheet } from './dom.js';

stylesheet('/css/viewer.css');
const QUALITY = ['auto', 'full', 'lite', 'low'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The toggles in each host (the view bar, the phone's compact bar), set as last time. */
export function viewModes(viewer, hosts) {
  let quality = QUALITY.includes(pref('studio.quality')) ? pref('studio.quality') : 'auto';
  const rows = hosts.map((host) => {
    const modes = ['playa', 'points'].map((m) => h('button', { type: 'button', class: 'view-btn mode-btn',
      dataset: { mode: m }, text: cap(m), onClick: () => setMode(m), title: m === 'playa'
        ? 'The night playa: glowing tubes, glass and floods' : 'Every LED a point of light: the lightest view' }));
    const q = h('button', { type: 'button', class: 'view-btn quality-btn', onClick: () => {
      pref('studio.quality', quality = QUALITY[(QUALITY.indexOf(quality) + 1) % 4]);
      viewer.setQuality(quality);
    } });
    host.append(h('div', { class: 'view-modes', role: 'group', 'aria-label': 'Render style' }, modes, q));
    return [modes, q];
  });
  const sync = viewer.onRender = (mode, tier) => {
    for (const [modes, q] of rows) {
      for (const b of modes) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
      Object.assign(q, { hidden: mode !== 'playa', textContent: cap(quality),
        title: `Playa quality: ${quality}${tier && quality === 'auto' ? `, now ${tier}` : ''}. Click to change.` });
    }
  };
  const setMode = async (m) => sync(await viewer.setMode(pref('studio.render', m) || m), viewer.playa?.tier);
  viewer.setQuality(quality);
  setMode(pref('studio.render') === 'points' ? 'points' : 'playa');
}
