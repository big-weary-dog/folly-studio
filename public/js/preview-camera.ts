// The gallery previews' camera page (src/previews/playa.ts loads it in a headless Chromium; the app never does): the
// Studio's own Viewer in its Playa view, from its default camera ('fit'), with the venue, at full quality. Each
// picture is drawn on demand (the Viewer's own frame loop is off), then scaled down to the canvas's CSS size so the
// 2× render smooths its edges.
import type { Light } from './core/light.ts';
import type { Venue } from './playa/venue.ts';
import { Viewer } from './viewer.ts';
import type { Rig } from '../../shared/schemas/rig.ts';

let viewer: Viewer | null = null;
const out = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;

/** The GPU's name (or the GL renderer's), so the server can tell a software one. */
function gpu(gl: WebGL2RenderingContext) {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

const api = {
  async setup(rig: Rig, venue: Venue | null, light?: Light) {
    viewer?.destroy();                          // its context is lost: a new rig gets a new canvas
    const canvas = document.createElement('canvas');
    document.querySelector('canvas')!.replaceWith(canvas);
    const v = viewer = new Viewer(canvas, { defaultView: 'fit' });
    v.setRig(rig);
    if (light) v.setLight(light);
    await v.setVenue(venue);
    v.setQuality('full');
    const mode = await v.setMode('playa');
    v.invalidate = () => {};
    cancelAnimationFrame(v.raf);
    out.canvas.width = canvas.clientWidth;
    out.canvas.height = canvas.clientHeight;
    return { mode, gpu: gpu(v.gl) };
  },
  /** Base64 RGB (each LED, rig order) → base64 RGB of the picture. */
  draw(leds: string) {
    const v = viewer!, bytes = Uint8Array.from(atob(leds), (c) => c.charCodeAt(0));
    v.setColors(Float32Array.from(bytes, (x) => x / 255));
    v.playa!.draw();
    const { width: w, height: h } = out.canvas;
    out.imageSmoothingQuality = 'high';
    out.drawImage(v.canvas, 0, 0, w, h);        // in the same task as the draw: the WebGL canvas still holds it
    const rgba = out.getImageData(0, 0, w, h).data;
    let s = '';
    for (let i = 0; i < rgba.length; i += 4) s += String.fromCharCode(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    return btoa(s);
  },
};
Object.assign(window, { previewCamera: api });
