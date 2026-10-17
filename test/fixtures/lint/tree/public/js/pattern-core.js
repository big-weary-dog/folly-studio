// The pattern compiler may generate code, but must stay deterministic.
export const compile = (code) => new Function(code);
export const noise = () => Math.random();
