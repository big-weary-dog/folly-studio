// The client's view of the API's shapes (SPEC "Looks", "HTTP API", "Baked frames"), until the server's schemas in
// shared/ carry them.

export interface User { id: string; username: string; role?: 'curator' | 'member' | string }

export type IdeaStatus = 'queued' | 'generating' | 'ready' | 'failed';
export interface Idea {
  id: string; text: string; status: IdeaStatus; generator?: string; error?: string | null; lookId?: string;
  createdAt?: string; updatedAt?: string;
}

export type Blend = 'add' | 'over' | 'max' | 'multiply';
export type Kind = 'source' | 'warp' | 'filter';

/** A number param's binding (SPEC "Param bindings"), in place of its value. */
export type Binding =
  | { mod: 'lfo'; shape?: string; rate?: number; unit?: 'hz' | 'beats'; center?: number; depth?: number }
  | { mod: 'global'; name: string; from?: number; to?: number }
  | { mod: 'envelope'; from?: number; to?: number };
export type ParamValue = number | string | boolean | number[] | Binding;

export interface Module {
  id: string; kind: Kind; title: string; ref?: string; code: string; params: Record<string, ParamValue>;
  input?: string; as?: 'input'; blend?: Blend; enabled?: false;
}
export interface Clip { start: number; end: number; fadeIn: number; fadeOut: number }
export interface Layer {
  id: string; title: string; modules: Module[]; groups: string[]; tags?: string[]; blend: Blend; level: number;
  clips?: Clip[];
}

export interface Macro { value: number; min: number; max: number }
export interface Palette { name: string; low: string[]; body: string[]; accent: string[]; high: string[] }
export interface Globals {
  speed?: number; level?: number; hue?: number; saturation?: number; energy?: number; palette?: Palette;
  macros?: Record<string, Macro>;
}
export type Automation = Record<string, [number, number][]>;

export interface Flicker {
  ok: boolean; flaggedSeconds: number[]; small?: { regions: string[]; flaggedSeconds: number[] };
}
export interface Bake {
  source?: string; status: 'queued' | 'running' | 'done' | 'failed'; ok?: boolean; reason?: string; warning?: string;
  seconds?: number; frames?: { bytes: number; sha256: string };
  analysis?: { flicker?: Flicker; peakBrightness: number; estPeakAmps: number; seconds: number };
}

/** What a look holds and saves (SPEC "Looks"). */
export interface LookBody {
  title: string; summary: string; layers: Layer[]; duration: number; bpm?: number | null; globals?: Globals | null;
  automation?: Automation | null;
}
/** A look as the server sends it. */
export interface Look extends LookBody {
  id: string; owner: string; ownerName?: string; shared?: boolean; reviewed?: boolean; bake?: Bake | null;
  ideaId?: string | null; createdAt?: string; updatedAt?: string;
}
/** A look as lists show it: no layers. */
export interface LookCard {
  id: string; owner: string; ownerName?: string; title: string; summary?: string; duration?: number;
  layerCount?: number; shared?: boolean; reviewed?: boolean; createdAt?: string; updatedAt?: string;
}

export interface LibraryEntry {
  name: string; title?: string; summary?: string; kind?: Kind; category?: string; tags?: string[]; code: string;
}

export interface Group { id: string; name: string; parent?: string | null; tags?: string[] }
/** The parts of the rig (SPEC "Rig") the UI reads; the viewer and the core read the rest. */
export interface Rig {
  count: number; groups: Group[]; views?: Record<string, unknown>;
  output: { universes: number; channelsPerUniverse: number };
}
