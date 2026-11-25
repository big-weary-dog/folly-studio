// pattern-core.ts: Folly Studio's pattern runtime (SPEC "Sandbox protocol"). Pure ES modules: no
// DOM, no globals touched. It runs in the sandbox's worker (Vite builds it in), in the boxes, from its source (the
// render box's realm takes it as one script: src/core-script.ts), and in the Node tests on our own library patterns.
export { DEFAULT_PALETTE, DIRECTIONS, OLD_DIRECTIONS, PALETTE_ROLES, STDLIB } from './stdlib.ts';
export type { Colour, Direction, PaletteColours, PaletteHex, PaletteRole, RGB } from './stdlib.ts';
export {
  compileModule, compilePattern, describeError, normalizeParams, setLibrary, SOURCE_PARAMS, upgradedParams,
  withSourceParams,
} from './compile.ts';
export { pickText, readPick } from './picks.ts';
export { pictureProblem, readPicture } from './picture.ts';
export type { Picture } from './picture.ts';
export type { PickBlend } from './picks.ts';
export type { Compiled, ParamSchema } from './compile.ts';
export {
  automationAt, isBinding, macroNameOk, MAX_LANES, MAX_MACROS, MAX_POINTS, normalizeGlobals, OLD_GLOBALS, prepareLook,
  readText, resolveParams, TEXT_MAX, upgradeGlobals,
} from './globals.ts';
export type { G, PreparedLook, Values } from './globals.ts';
export { groupsByTag, pixelsForGroups, prepareScene, tagCentres, tagMask } from './scene.ts';
export type { Scene } from './scene.ts';
export { FLASH, flashLimits, FlashWatch } from './flash.ts';
export type { Flashes, FlashLimits } from './flash.ts';
export {
  DEFAULT_DURATION, layerEnvelope, lookDuration, MAX_CLIPS, MAX_DURATION, MIN_DURATION, normalizeClips, TRANSITIONS,
  transitionWeight,
} from './timeline.ts';
export {
  BLENDS, CHAIN_KINDS, compileLayer, layerModules, MODULE_KINDS, prepareLayer, renderFrame, SOURCE_BLENDS,
} from './render.ts';
export { isStageEnd, stageOf } from './warps.ts';
export { attachedTo, flatModules } from './tree.ts';
export {
  LIGHT, type Light, LIGHT_LIMITS, ledChannels, ledLight, lightByte, lightOf, prepareLight,
} from './light.ts';
export { toChannels } from './output.ts';
export { BLUR_MODES, DEFAULT_SOFTEN, MAX_RADIUS, neighbourGraph } from './spatial.ts';
export type { BlurMode, Neighbours } from './spatial.ts';
export { linkMap, waveStep } from './links.ts';
export type { Links } from './links.ts';
export type { Blend, LayerInput, ModuleKind, Pixel, PreparedLayer, SourceBlend } from './render.ts';
export type { CompiledLink } from './chain.ts';
