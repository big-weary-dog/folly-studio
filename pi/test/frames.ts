// Test frames for the rose expansion and the power compressor, cell-level (the Studio rig's channels), made the same
// way every time: dark, full white (Rule 2 and Rule 3 both cut), a fall to dark (the release), noise, the rose alone,
// half white, one Bright Set at a time.
export const CELL_CHANNELS = 38250;     // the CoG rig's frame (75 universes × 510): the expanded rose starts after it

/** n frames of `channels` bytes, back to back. */
export function testFrames(n = 48, channels = CELL_CHANNELS) {
  const data = new Uint8Array(n * channels);
  let seed = 0x9e3779b9;
  const rand = () => { seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; return seed >>> 24; };
  for (let f = 0; f < n; f++) {
    const fr = data.subarray(f * channels, (f + 1) * channels);
    if (f >= 1 && f < 5) fr.fill(255);
    else if (f >= 18 && f < 26) for (let i = 0; i < channels; i++) fr[i] = rand();
    else if (f >= 26 && f < 30) fr.fill(255, 0, 1020);
    else if (f >= 30 && f < 36) fr.fill(128 + (f - 30) * 20);
    else if (f >= 36) fr.fill(255, ((f - 36) * 3187) % channels, ((f - 36) * 3187) % channels + 6000);
  }
  return data;
}
