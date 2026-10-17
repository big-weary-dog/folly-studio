// pattern-core.js: Folly Studio's pattern runtime (SPEC "Sandbox protocol"). Pure ES modules: no
// DOM, no globals touched. It runs in the sandbox's worker and in the render box, where the server
// ships it as one script (src/bundle.js), and in the Node tests on our own library patterns.
export { DEFAULT_PALETTE, PALETTE_ROLES, STDLIB, STDLIB_NAMES } from './core/stdlib.js';
export { compileModule, compilePattern, describeError, normalizeParams, setLibrary } from './core/compile.js';
export {
  automationAt, GLOBALS, isBinding, macroNameOk, MAX_LANES, MAX_MACROS, MAX_POINTS, normalizeGlobals, prepareLook,
  resolveParams,
} from './core/globals.js';
export {
  DEFAULT_DURATION, layerEnvelope, lookDuration, MAX_CLIPS, MAX_DURATION, MIN_DURATION, normalizeClips,
  pixelsForGroups, prepareScene,
} from './core/scene.js';
export {
  BLENDS, compileLayer, layerModules, MODULE_KINDS, prepareLayer, renderFrame, toChannels,
} from './core/render.js';
