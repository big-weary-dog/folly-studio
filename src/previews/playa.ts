// The gallery previews' camera (SPEC "Gallery previews"): the Studio's Playa view, rendered on the GPU by a headless
// Chromium (playwright-core's) that the server starts on first use and closes when idle. It has its own profile and
// no window, and serves itself the viewer's source (types stripped) from this checkout, so it needs no build, no
// port and no login. Under WSL it reaches the GPU through Mesa's d3d12 driver. One picture at a time; the previews'
// queue already runs one look at a time.

import { existsSync, promises as fs } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Browser, Page } from 'playwright-core';

import type { Light } from '../../public/js/pattern-core.ts';
import type { Rig } from '../../shared/schemas/rig.ts';
import type { Logger } from '../http.ts';
import { type Camera, HEIGHT, WIDTH } from './motion.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ORIGIN = 'http://preview.camera';
const SERVED = /^\/(public\/js|shared\/schemas)\/[\w/-]+\.ts$/;  // what the page imports, no more
const IDLE_MS = 60_000;
const WSL = '/usr/lib/wsl/lib';
const HTML = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}
canvas{display:block;width:${WIDTH}px;height:${HEIGHT}px}</style><canvas></canvas>
<script type="module">import '/public/js/preview-camera.ts';</script>`;

// public/js/preview-camera.ts's API (server code may not import it, even its types).
declare global { interface Window { previewCamera: {
  setup(rig: Rig, venue: unknown, light?: Light): Promise<{ mode: string, gpu: string }>,
  draw(leds: string): string } } }

/** Software renderers draw it too, but slowly: the server asks for a GPU and says when it has none. */
const isSoftware = (gpu: string) => /swiftshader|llvmpipe|softpipe|software/i.test(gpu);

/** Chromium's flags and environment for a GPU: WSL's d3d12 Mesa when /dev/dxg is there, else the system's GL. */
function launchOptions() {
  const args = ['--use-gl=angle', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'];  // EGL: no display
  // No display: the headless shell still opens one when told of it, and hangs while it does not answer (WSLg's).
  const { DISPLAY: _x, WAYLAND_DISPLAY: _w, ...env } = process.env;
  if (!existsSync('/dev/dxg') || !existsSync(WSL)) return { args, env };
  return { args, env: { ...env, GALLIUM_DRIVER: 'd3d12', MESA_D3D12_DEFAULT_ADAPTER_NAME: 'NVIDIA',
    LD_LIBRARY_PATH: [WSL, env.LD_LIBRARY_PATH].filter(Boolean).join(':') } };
}

async function open(log: Logger) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ headless: true, ...launchOptions() });
  try {
    const page = await (await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 }))
      .newPage();
    await page.route(`${ORIGIN}/**`, async (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/') return route.fulfill({ contentType: 'text/html', body: HTML });
      if (!SERVED.test(p) || p.includes('..')) return route.fulfill({ status: 404 });
      const ts = await fs.readFile(path.join(ROOT, p), 'utf8').catch(() => null);
      if (ts == null) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: 'text/javascript', body: stripTypeScriptTypes(ts) });
    });
    page.on('pageerror', (err) => log.error?.('[previews] camera page:', err.message));
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => !!window.previewCamera);
    return { browser, page };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

/** The camera, and close() for shutdown. `loadLight`: the light settings, for the view's preview transform. */
export function playaCamera({ log = console, idleMs = IDLE_MS, loadLight }: { log?: Logger, idleMs?: number,
  loadLight?: () => Light } = {}) {
  let session: Promise<{ browser: Browser, page: Page }> | null = null, rigShown = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = async () => {
    clearTimeout(timer);
    const s = session;
    session = null;
    rigShown = '';
    await (await s?.catch(() => null))?.browser.close().catch(() => {});
  };
  const camera: Camera = async (rig, samples) => {
    clearTimeout(timer);
    try {
      session ??= open(log);
      const { page } = await session;
      const light = loadLight?.(), shown = JSON.stringify([rig, light]);    // loadRig() reads it afresh each time
      if (rigShown !== shown) {
        const venue = JSON.parse(await fs.readFile(path.join(ROOT, 'public/data/venue.json'), 'utf8')
          .catch(() => 'null'));
        const { mode, gpu } = await page.evaluate(([r, v, l]) => window.previewCamera.setup(r, v, l),
          [rig, venue, light] as const);
        if (mode !== 'playa') throw new Error(`no Playa view here (${gpu})`);
        log[isSoftware(gpu) ? 'warn' : 'info']?.(`[previews] camera on ${gpu}`);
        rigShown = shown;
      }
      const pictures: Uint8Array[] = [];
      for (const s of samples) {
        const b64 = await page.evaluate((leds) => window.previewCamera.draw(leds), Buffer.from(s).toString('base64'));
        pictures.push(Buffer.from(b64, 'base64'));
      }
      return { width: WIDTH, height: HEIGHT, pictures };
    } catch (err) {
      await close();
      throw err;
    } finally {
      if (session) {
        timer = setTimeout(() => void close(), idleMs);
        timer.unref();
      }
    }
  };
  return { camera, close };
}
