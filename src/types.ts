export type Activation = {
  eventId: string;
  scoreId: string;
  time: number;
  duration: number;
  pitch: number;
  velocity: number;
  staff: 1 | 2;
  x: number;
  y: number;
  system: number;
  kind: 'attack' | 'sustain';
};

export type ScoreProject = {
  title: string;
  subtitle: string;
  svg: string;
  width: number;
  height: number;
  duration: number;
  events: Activation[];
  midiCount: number;
  unmatched: number;
  pageCount: number;
  sample: boolean;
  partCount?: number;
  pianoPartName?: string;
  pianoTrackNames?: string[];
  pianoMatchedCount?: number;
  midiTrackCount?: number;
  soundingTrackCount?: number;
};

export type ScoreDirection = 'serpentine' | 'standard';

export type ViewSettings = {
  direction: ScoreDirection;
  cameraDistance: number;
  glow: number;
  follow: number;
  speed: number;
  violet: string;
  amber: string;
};
