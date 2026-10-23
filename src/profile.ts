// The Pi profile (SPEC-offline "The Pi profile"): what STUDIO_PROFILE=pi changes, read in one place.
import type { Config } from './config.ts';

export type Profile = 'hosted' | 'pi';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const PI_FRAMES_MAX_BYTES = 1024 ** 3, PI_BAKE_MEMORY = 384 * 1024 ** 2;

export const profileOf = (c: Config): Profile => c.STUDIO_PROFILE ?? 'hosted';

/** The settings the profile defaults: the gallery previews' camera, the baked frames' disk cap, and a bake's nice
 * level and memory (the Pi's at the bottom, under the engine, which drives the lights on the same CPUs). */
export const profileDefaults = (profile: Profile) => (profile === 'pi'
  ? { previews: 'front', framesMaxBytes: PI_FRAMES_MAX_BYTES, bakeNice: 19, bakeMemory: PI_BAKE_MEMORY }
  : { previews: 'playa', framesMaxBytes: undefined, bakeNice: undefined, bakeMemory: undefined });

/** Profile defaults for the box, overridden by explicit settings. */
export const boxDefaults = (profile: Profile, c: Config) => {
  const d = profileDefaults(profile);
  return { nice: c.STUDIO_BAKE_NICE ?? d.bakeNice, memoryBytes: c.STUDIO_BAKE_MEMORY ?? d.bakeMemory,
    seconds: c.STUDIO_BAKE_SECONDS || (profile === 'pi' ? 600 : undefined) };
};
/** Why the server may not listen on `host` under `profile`, or '' when it may. */
export const hostRefusal = (profile: Profile, host: string) => (profile === 'pi' || LOOPBACK.has(host) ? ''
  : `HOST=${host}: the hosted Studio listens on loopback only, behind its tunnel (STUDIO_PROFILE=pi on the Pi).`);

/** Whether the profile runs generators, and their routes and pages with them. */
export const generates = (profile: Profile) => profile !== 'pi';
