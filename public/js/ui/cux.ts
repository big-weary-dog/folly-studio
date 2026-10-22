// Prototype only (reports/composite-ux): which composite look the chain draws, `?cux=a|b|c` (none: dev's), and in C the
// sub-layer picked in the Layers panel, its chain shown in Settings.
import { signal } from '@preact/signals';

export const CUX = typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('cux') ?? '';
export const cuxSub = signal<{ comp: string, k: number } | null>(null);
