// npm run smoke, too: the live pages when the stage's socket gets no state. A socket that opens and says nothing
// shows "Can't reach the stage" after 10 s; one the server closes with 1013 shows "The stage is full"; both keep
// retrying. Screenshots of each, at 1366 and 390 wide, in the output.
import { expect, signup, test } from './studio.js';

const LAPTOP = { viewport: { width: 1366, height: 768 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
test.use({ serverOptions: { curators: 'conductor' } });

/** `url` in a signed-in context of `device`, its stage socket answered by `route` (Playwright's WebSocketRoute). */
async function open(browser, origin, cookie, device, url, route) {
  const ctx = await browser.newContext(device);
  const [name, value] = cookie.split('=');
  await ctx.addCookies([{ name, value, url: origin }]);
  const page = await ctx.newPage();
  let sockets = 0;
  await page.routeWebSocket(/\/api\/live\/socket$/, (ws) => { sockets++; route(ws); });
  await page.goto(`${origin}${url}`);
  return { ctx, page, sockets: () => sockets };
}

test('the live pages say when the stage cannot be reached, or is full, and keep trying', async ({ browser, studio },
  info) => {
  const { origin } = studio;
  const conductor = await signup(origin, 'conductor');
  const shot = (page, step) => page.screenshot({ path: info.outputPath(`${step}.png`), timeout: 60_000 });
  const silent = () => {};                               // opens, never sends a state
  const full = (ws) => ws.close({ code: 1013, reason: 'The stage is full.' });

  for (const [device, wide] of [[PHONE, 390], [LAPTOP, 1366]]) {
    await test.step(`unreachable, ${wide} wide`, async () => {
      const control = await open(browser, origin, conductor, device, '/live/control', silent);
      const live = await open(browser, origin, conductor, device, '/live', silent);
      await expect(control.page.locator('.live-control')).toHaveText('Connecting to the stage…');
      await expect(control.page.locator('.live-control')).toHaveText("Can't reach the stage. Retrying…",
        { timeout: 15_000 });
      await expect(live.page.locator('.viewer-msg')).toHaveText("Can't reach the stage. Retrying…",
        { timeout: 15_000 });
      await shot(control.page, `unreachable-control-${wide}`);
      await shot(live.page, `unreachable-live-${wide}`);
      await control.ctx.close();
      await live.ctx.close();
    });
    await test.step(`full, ${wide} wide`, async () => {
      const control = await open(browser, origin, conductor, device, '/live/control', full);
      const live = await open(browser, origin, conductor, device, '/live', full);
      await expect(control.page.locator('.live-control')).toHaveText('The stage is full. Retrying…');
      await expect(live.page.locator('.viewer-msg')).toHaveText('The stage is full. Retrying…');
      await expect.poll(control.sockets, { timeout: 10_000 }).toBeGreaterThan(2);   // still retrying
      await shot(control.page, `full-control-${wide}`);
      await shot(live.page, `full-live-${wide}`);
      await control.ctx.close();
      await live.ctx.close();
    });
  }
});
