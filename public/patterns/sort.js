// Sort: along each strand, the light slides to one end: every run of LEDs at least Cutoff bright has its colours
// sorted by brightness (or by hue), the brightest toward Direction, the glitch-art pixel sort. Up and down rank the
// run's LEDs by height, so on an arch the light piles up at the top. The core runs it over the whole layer at once
// (SPEC "Spatial modules"); filter() is what a core without it does. A stage end: no warp below it bends what is above.
const spatial = 'sort';
const stage = 'spatial';
const params = {
  by: { value: 'brightness', type: 'choice', options: ['brightness', 'colour'], label: 'By',
    help: 'brightness slides the bright light to one end; colour lines the hues up in order, red to violet.' },
  direction: { value: 'up', type: 'choice', options: ['up', 'down', 'start', 'end'], label: 'Direction',
    help: 'Where the bright light gathers: the top or bottom of each run, or the start or end of its wire.' },
  cutoff: { value: 0, min: 0, max: 1, step: 0.01, label: 'Cutoff',
    help: 'Only LEDs this bright get sorted; darker ones stay and break the runs. 0 sorts whole strands.' },
  amount: { value: 1, min: 0, max: 1, step: 0.01, label: 'Amount',
    help: 'How far toward fully sorted. 0 leaves it as it was; 0.5 ghosts the sorted light over the original.' },
};

function filter(c) {
  return c;
}
