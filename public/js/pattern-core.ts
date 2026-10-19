// pattern-core.ts: Folly Studio's pattern runtime (SPEC "Sandbox protocol"). Pure ES modules: no
// DOM, no globals touched. It runs in the sandbox's worker (Vite builds it in), in the boxes, from its source (the
// render box's realm takes it as one script: src/core-script.ts), and in the Node tests on our own library patterns.
export { DEFAULT_PALETTE, PALETTE_ROLES, STDLIB, STDLIB_NAMES } from './core/stdlib.ts';
export type { Colour, PaletteColours, PaletteHex, PaletteRole, RGB } from './core/stdlib.ts';
export { compileModule, compilePattern, describeError, normalizeParams, setLibrary } from './core/compile.ts';
export type { Compiled, ParamSchema, ParamSpec } from './core/compile.ts';
export {
  automationAt, GLOBALS, isBinding, macroNameOk, MAX_LANES, MAX_MACROS, MAX_POINTS, normalizeGlobals, prepareLook,
  resolveParams,
} from './core/globals.ts';
export type { G, PreparedLook, Values } from './core/globals.ts';
export { flashRegions, groupsByTag, LARGE, pixelsForGroups, prepareScene, tagCentres, tagMask } from './core/scene.ts';
export type { Region, Scene } from './core/scene.ts';
export {
  DEFAULT_DURATION, layerEnvelope, lookDuration, MAX_CLIPS, MAX_DURATION, MIN_DURATION, normalizeClips,
} from './core/timeline.ts';
export {
  BLENDS, compileLayer, layerModules, MODULE_KINDS, prepareLayer, renderFrame, SOURCE_BLENDS,
} from './core/render.ts';
export { isStageEnd } from './core/warps.ts';
export { toChannels } from './core/output.ts';
export { BLUR_MODES, DEFAULT_SOFTEN, MAX_RADIUS, neighbourGraph } from './core/spatial.ts';
export type { BlurMode, Neighbours } from './core/spatial.ts';
export type { Blend, LayerInput, ModuleKind, Pixel, PreparedLayer, SourceBlend } from './core/render.ts';
