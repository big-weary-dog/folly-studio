// Pi startup follows an engine source before a control command; fixtures render locally and send no lighting data.
import { engineOn } from '../../pi/test/fixture.ts';
import { piNowOf } from '../../src/live/pi-feed.ts';
import { expect, signup, test } from './studio.js';

test.use({ serverOptions: { profile: 'pi' } });
test('a read-only viewer follows the engine before anyone takes controls', async ({ page, studio }) => {
  const r = engineOn();
  r.engine.play('clockwork-rose');
  r.run(1.5);
  studio.app.hub.piSource(r.engine.source());
  studio.app.hub.piNow(piNowOf(r.engine.state()));
  const cookie = await signup(studio.origin, 'startup-viewer');
  const [name, value] = cookie.split('=');
  await page.context().addCookies([{ name, value, url: studio.origin }]);
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(`${studio.origin}/live?probe=1`);
    await expect(page.locator('.live-driver')).toHaveText('driven from /pi');
    await expect(page.locator('.live-title')).toHaveText(r.engine.state().look.title);
    const lit = () => page.evaluate(() => Math.max(0, ...window.__liveProbe.frames.values()));
    await expect.poll(lit, { timeout: 60_000 }).toBeGreaterThan(0);
    await expect(page.getByText('Nothing is playing yet.')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`live-startup-${width}.png`) });
  }
  r.engine.close();
});
