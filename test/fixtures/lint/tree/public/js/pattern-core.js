// The pattern core's entry: the compiler lives in core/, and the core must stay deterministic.
export { compile } from './core/compile.js';
export const noise = () => Math.random();
