// Transport: play/pause, restart, time readout, scrub, speed.
import { h, formatTime, nextId } from './dom.js';

export const SPEEDS = [0.25, 0.5, 1, 2, 4];

export class Transport {
  constructor(container, { onPlay, onSeek, onSpeed, onRestart }) {
    const scrubId = nextId('scrub'), speedId = nextId('speed');
    this.play = h('button', { type: 'button', class: 'tp-play', 'aria-label': 'Pause', onClick: () => onPlay() });
    this.restart = h('button', { type: 'button', class: 'tp-btn tp-restart', 'aria-label': 'Back to start',
      title: 'Back to start', onClick: () => onRestart() });
    this.time = h('span', { class: 'tp-time', 'aria-label': 'Time' });
    this.scrub = h('input', { type: 'range', id: scrubId, class: 'tp-scrub', min: 0, max: 30, step: 0.01, value: 0,
      onInput: () => onSeek(+this.scrub.value) });
    this.scrubbing = false;
    for (const [type, on] of [['pointerdown', true], ['pointerup', false], ['blur', false]]) {
      this.scrub.addEventListener(type, () => { this.scrubbing = on; });
    }
    this.speed = h('select', { id: speedId, class: 'tp-speed', onChange: () => onSpeed(+this.speed.value) },
      SPEEDS.map((s) => h('option', { value: String(s), text: `${s}×` })));
    this.speed.value = '1';
    this.stats = h('span', { class: 'tp-stats', 'aria-hidden': 'true' });
    this.el = h('div', { class: 'transport', role: 'group', 'aria-label': 'Transport' }, this.restart, this.play,
      this.time, h('label', { for: scrubId, class: 'sr-only', text: 'Scrub time' }), this.scrub,
      h('label', { for: speedId, class: 'sr-only', text: 'Speed' }), this.speed, this.stats);
    container.append(this.el);
    this._last = { playing: null, t: -1, duration: -1, at: 0 };
  }

  /** Every frame: touches the DOM only when something visible changes, the clock ≤ 8 times a second. */
  set(playing, t, duration, now = performance.now()) {
    const L = this._last;
    let force = false;
    if (playing !== L.playing) {
      L.playing = playing;
      force = true;
      this.play.classList.toggle('playing', playing);
      this.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      this.play.title = playing ? 'Pause (Space)' : 'Play (Space)';
    }
    if (duration !== L.duration) {
      L.duration = duration;
      force = true;
      this.scrub.max = String(duration);
    }
    if (t === L.t || (!force && playing && now - L.at < 120)) return;
    L.t = t;
    L.at = now;
    this.time.textContent = `${formatTime(t)} / ${formatTime(duration)}`;
    if (!this.scrubbing) this.scrub.value = String(t);
  }

  setStats(text) {
    if (this.stats.textContent !== text) this.stats.textContent = text;
  }
}
