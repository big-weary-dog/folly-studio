// pattern-core.ts: Folly Studio's pattern runtime (SPEC "Sandbox protocol"). Pure ES modules: no
// DOM, no globals touched. It runs in the sandbox's worker (Vite builds it in), in the boxes, from its source (the
// render box's realm takes it as one script: src/core-script.ts), and in the Node tests on our own library patterns.
export { DEFAULT_PALETTE, DIRECTIONS, PALETTE_ROLES, STDLIB, STDLIB_NAMES } from './core/stdlib.ts';
export type { Colour, Direction, PaletteColours, PaletteHex, PaletteRole, RGB } from './core/stdlib.ts';
export { compileModule, compilePattern, describeError, normalizeParams, setLibrary } from './core/compile.ts';
export { pickText, readPick } from './core/picks.ts';
export { EMPTY_PICTURE, PICTURE_COLOUR, PICTURE_LIMITS, pictureProblem, readPicture } from './core/picture.ts';
export type { Picture } from './core/picture.ts';
export type { PickBlend, PickSpec } from './core/picks.ts';
export type { Compiled, ParamSchema, ParamSpec } from './core/compile.ts';
export {
  automationAt, GLOBALS, isBinding, macroNameOk, MAX_LANES, MAX_MACROS, MAX_POINTS, normalizeGlobals, prepareLook,
  resolveParams,
} from './core/globals.ts';
export type { G, PreparedLook, Values } from './core/globals.ts';
export { groupsByTag, pixelsForGroups, prepareScene, tagCentres, tagMask } from './core/scene.ts';
export type { Scene } from './core/scene.ts';
export { FLASH, flashLimits, FlashWatch } from './core/flash.ts';
export type { Flashes, FlashLimits } from './core/flash.ts';
export {
  DEFAULT_DURATION, layerEnvelope, lookDuration, MAX_CLIPS, MAX_DURATION, MIN_DURATION, normalizeClips, TRANSITIONS,
  transitionWeight,
} from './core/timeline.ts';
export {
  BLENDS, compileLayer, layerModules, MODULE_KINDS, prepareLayer, renderFrame, SOURCE_BLENDS,
} from './core/render.ts';
export { isStageEnd, stageOf, STAGES } from './core/warps.ts';
export { toChannels } from './core/output.ts';
export { BLUR_MODES, DEFAULT_SOFTEN, MAX_RADIUS, neighbourGraph } from './core/spatial.ts';
export type { BlurMode, Neighbours } from './core/spatial.ts';
export type { Blend, LayerInput, ModuleKind, Pixel, PreparedLayer, SourceBlend } from './core/render.ts';
