// Before a shot, the Studio's preview has drawn frames: its scrub, which each drawn frame moves, has shown a few
// times. Faster than a fixed wait, and it fails if the preview has stopped.
import { expect } from '@playwright/test';

/** Wait until the preview has drawn `frames` more frames. */
export async function drawn(page, frames = 6) {
  const scrub = page.locator('.tp-scrub').first(), seen = new Set();
  await expect.poll(async () => seen.add(await scrub.inputValue()).size, { message: 'the preview draws frames',
    timeout: 15_000, intervals: [50] }).toBeGreaterThan(frames);
}
