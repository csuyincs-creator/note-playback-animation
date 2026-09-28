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

export type ScoreTheme = 'classic-ivory' | 'neon-inverted' | 'dark-obsidian' | 'original-vintage';
export type UITheme = 'studio-dark' | 'classical-ink' | 'light-studio';
export type JumpStyle = 'elastic' | 'fluid' | 'staccato' | 'comet' | 'float';
export type CameraTurn = 'wide-arc' | 'cinematic' | 'constant-glide';

export type ParticleEffect =
  | 'all'        // 全部华丽
  | 'stardust'   // 璀璨星尘
  | 'ribbon'     // 流光彩带
  | 'notes'      // 乐符微尘
  | 'aurora'     // 极光幻彩
  | 'firefly'    // 萤火追踪
  | 'fireworks'  // 烟花绽放
  | 'inkwash'    // 水墨晕染
  | 'lightning'  // 电光脉冲
  | 'bubbles'    // 气泡升腾
  | 'minimal';   // 纯净流线

export type ViewSettings = {
  direction: ScoreDirection;
  cameraDistance: number;
  glow: number;
  follow: number;
  speed: number;
  violet: string;
  amber: string;
  scoreTheme?: ScoreTheme;
  uiTheme?: UITheme;
  vignette?: boolean;
  jumpStyle?: JumpStyle;
  jumpHeight?: number;
  bounciness?: number;
  cameraTurn?: CameraTurn;
  particleEffect?: ParticleEffect;
  particleDensity?: number;
  ribbonWidth?: number;
  velocityResponse?: boolean;   // 力度响应
  pitchColor?: boolean;         // 音高色谱
  trailFork?: boolean;          // 尾迹分叉
  idleOrbit?: boolean;          // 待机光环
  landingRipple?: boolean;      // 落地涟漪
};
