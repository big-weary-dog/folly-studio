// The tutorial's paths, in the order Tutorials lists them. First look is the one that opens by itself.
import { colour } from './colour.ts';
import { firstLook } from './first-look.ts';
import { keep } from './keep.ts';
import { layers } from './layers.ts';
import { move } from './move.ts';

export const PATHS = [firstLook, layers, move, colour, keep];
