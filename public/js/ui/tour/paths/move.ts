// Movement and time: play and pause, a value that moves by itself or with the beat, the tempo, a clip, automation.
import { boundTo, type Ctx, layerBy, type Path } from '../types.ts';

const onBars = (c: Ctx) => c.v?.module.value?.ref === 'bars' && c.v.selected.value?.id === layerBy(c, 'plasma')?.id;
const points = (c: Ctx) => Object.values(c.v?.automation.value ?? {}).reduce((a, n) => a + n, 0);

export const move: Path = {
  id: 'move', title: 'Movement and time', minutes: 4, start: '/studio?tour=move',
  about: 'Play and pause, values that move by themselves or on the beat, the tempo, clips and automation.',
  steps: [
    { id: 'play', page: '/studio', title: 'Play and pause',
      text: '▶ plays the look and pauses it; Space does too, anywhere but a field. Pause it now.',
      anchor: ['play'], begin: (c) => c.v?.playing.peek(), done: (c, was) => !!c.v && c.v.playing.value !== was },
    { id: 'bars', page: '/studio', title: 'Find the bars',
      text: 'Click {preset:plasma}, then its {module:bars} module.', anchor: ['layer:plasma', 'module:bars'],
      done: onBars },
    { id: 'lfo', page: '/studio', title: 'A value that moves',
      text: '∿ at the end of {param:bars.bars} moves it by itself, to and fro. Open it and pick a wave.',
      anchor: ['param:bars'], done: (c) => onBars(c) && !!boundTo(c.v!.params.value.bars)
        && boundTo(c.v!.params.value.bars) !== 'beats' },
    { id: 'bpm', page: '/studio', title: 'The tempo',
      text: 'The look\'s tempo is in the Timeline. Set BPM to 120.', anchor: ['dock:timeline', 'bpm'],
      done: (c) => c.v?.bpm.value === 120 },
    { id: 'clock', page: '/studio', title: 'On the beat',
      text: 'The clock beside {param:bars.speed} ties it to the tempo, so it keeps time with the music. Click it.',
      anchor: ['param:speed'], done: (c) => onBars(c) && boundTo(c.v!.params.value.speed) === 'beats' },
    { id: 'clip', page: '/studio', title: 'A clip',
      text: 'A clip plays a layer for part of the look only. + Clip adds one to the selected layer at the playhead.',
      anchor: ['dock:timeline', 'clip-add'], begin: (c) => c.v?.selected.peek()?.clips ?? 0,
      done: (c, n) => (c.v?.selected.value?.clips ?? 0) > (n as number) },
    { id: 'automate', page: '/studio', title: 'Automation',
      text: 'Automation moves a value across the look. Pick one from + Automate…, then click in its lane to add '
        + 'a point.',
      anchor: ['dock:timeline', 'automate'], begin: points, done: (c, n) => points(c) > (n as number), next: true },
  ],
};
