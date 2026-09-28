import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {demo} from './demo';
import {processFiles} from './scoreProcessor';
import {applyScoreDirection} from './scoreLayout';
import {ScoreStage} from './ScoreStage';
import {EnsembleAudio} from './ensembleAudio';
import {beginVideoRecording} from './videoRecorder';
import type {RecordingState} from './videoRecorder';
import type {ScoreProject, ViewSettings} from './types';

const defaults: ViewSettings = {
  direction: 'serpentine',
  cameraDistance: .44,
  glow: .85,
  follow: .94,
  speed: 1,
  violet: '#bda0ff',
  amber: '#ffbc6d',
  scoreTheme: 'classic-ivory',
  uiTheme: 'studio-dark',
  vignette: false,
  jumpStyle: 'elastic',
  jumpHeight: 1.0,
  bounciness: 1.0,
  cameraTurn: 'wide-arc',
  particleEffect: 'all',
  particleDensity: 1.0,
  ribbonWidth: 1.2,
  velocityResponse: true,
  pitchColor: false,
  trailFork: false,
  idleOrbit: true,
  landingRipple: true,
};

const fmt = (seconds: number) =>
  `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

const saveFile = (name: string, content: string, type = 'application/json') => {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function audioDuration(file: File | null) {
  if (!file) return Promise.resolve(0);
  return new Promise<number>(resolve => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const finish = (duration: number) => {
      audio.src = '';
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => finish(0);
    audio.preload = 'metadata';
    audio.src = url;
  });
}

function sanitizeProject(value: unknown): ScoreProject {
  const p = (value as {project?: ScoreProject})?.project || (value as Partial<ScoreProject>);
  if (
    !p ||
    typeof p.svg !== 'string' ||
    !Array.isArray(p.events) ||
    !p.events.length ||
    !Number.isFinite(p.width) ||
    !Number.isFinite(p.height) ||
    !Number.isFinite(p.duration)
  )
    throw new Error('项目 JSON 缺少曲谱或事件。');
  const xml = new DOMParser().parseFromString(p.svg, 'image/svg+xml');
  if (xml.querySelector('parsererror') || xml.documentElement.tagName.toLowerCase() !== 'svg')
    throw new Error('项目中的 SVG 无效。');
  xml.querySelectorAll('script,foreignObject,iframe,object').forEach(node => node.remove());
  xml.querySelectorAll('*').forEach(node => {
    for (const attr of [...node.attributes])
      if (/^on/i.test(attr.name) || (/href$/i.test(attr.name) && !attr.value.startsWith('#')))
        node.removeAttribute(attr.name);
  });
  return {...p, svg: new XMLSerializer().serializeToString(xml.documentElement)} as ScoreProject;
}

/* --- 精致矢量图标 --- */
function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M7 4.5v15l12-7.5-12-7.5z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}

function IconRewind5() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4A8 8 0 1 0 20 12" />
      <path d="M12 1v6l-4-3 4-3z" fill="currentColor" stroke="none" />
      <text x="12" y="15" fontSize="7.5" fontFamily="system-ui, sans-serif" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">5</text>
    </svg>
  );
}

function IconForward5() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4a8 8 0 1 1-8 8" />
      <path d="M12 1v6l4-3-4-3z" fill="currentColor" stroke="none" />
      <text x="12" y="15" fontSize="7.5" fontFamily="system-ui, sans-serif" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">5</text>
    </svg>
  );
}

function IconExpand() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

function IconScore() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M8 7h8M8 11h6" />
    </svg>
  );
}

function IconMidi() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8v4M12 8v4M17 8v4M7 16h.01M12 16h.01M17 16h.01" />
    </svg>
  );
}

function IconAudio() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 10v4M6 6v12M10 3v18M14 8v8M18 5v14M22 10v4" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

function IconReset() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function FileSlot({
  label,
  hint,
  accept,
  file,
  icon,
  onChange,
  disabled = false,
}: {
  label: string;
  hint: string;
  accept: string;
  file: File | null;
  icon: React.ReactNode;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`file-slot ${file ? 'has-file' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <span className="file-icon-box">{file ? <IconCheck /> : icon}</span>
      <span className="file-copy">
        <strong title={file ? file.name : label}>{file ? file.name : label}</strong>
        <small>{file ? `${(file.size / 1024).toFixed(1)} KB · 点击替换` : hint}</small>
      </span>
      <input type="file" accept={accept} disabled={disabled} onChange={event => onChange(event.target.files?.[0] || null)} />
    </label>
  );
}

const presets: Record<string, Partial<ViewSettings>> = {
  '电影级': {
    particleEffect: 'aurora', glow: 1.0, jumpStyle: 'fluid', cameraTurn: 'cinematic',
    velocityResponse: true, pitchColor: true, trailFork: true, idleOrbit: true, landingRipple: true,
    particleDensity: 1.4, ribbonWidth: 1.6, vignette: true,
  },
  '演奏会': {
    particleEffect: 'stardust', glow: 0.7, jumpStyle: 'elastic', cameraTurn: 'wide-arc',
    velocityResponse: true, pitchColor: false, trailFork: false, idleOrbit: true, landingRipple: true,
    particleDensity: 0.8, ribbonWidth: 1.0,
  },
  '教学纯净': {
    particleEffect: 'minimal', glow: 0.4, jumpStyle: 'elastic', cameraTurn: 'constant-glide',
    velocityResponse: false, pitchColor: false, trailFork: false, idleOrbit: false, landingRipple: false,
    particleDensity: 0.3, ribbonWidth: 0.8, vignette: false,
  },
  '梦幻童话': {
    particleEffect: 'bubbles', glow: 0.9, jumpStyle: 'float', cameraTurn: 'cinematic',
    velocityResponse: false, pitchColor: true, trailFork: true, idleOrbit: true, landingRipple: true,
    particleDensity: 1.5, ribbonWidth: 1.8,
  },
  '赛博朋克': {
    particleEffect: 'lightning', glow: 1.2, jumpStyle: 'staccato', cameraTurn: 'wide-arc',
    velocityResponse: true, pitchColor: true, trailFork: true, idleOrbit: true, landingRipple: true,
    particleDensity: 1.6, ribbonWidth: 1.0, scoreTheme: 'neon-inverted',
  },
  '水墨古韵': {
    particleEffect: 'inkwash', glow: 0.5, jumpStyle: 'fluid', cameraTurn: 'cinematic',
    velocityResponse: true, pitchColor: false, trailFork: false, idleOrbit: false, landingRipple: true,
    particleDensity: 1.0, ribbonWidth: 0.9, scoreTheme: 'original-vintage',
  },
  '夏夜萤火': {
    particleEffect: 'firefly', glow: 0.8, jumpStyle: 'float', cameraTurn: 'wide-arc',
    velocityResponse: true, pitchColor: false, trailFork: false, idleOrbit: true, landingRipple: false,
    particleDensity: 1.2, ribbonWidth: 1.0, scoreTheme: 'dark-obsidian',
  },
  '烟花盛典': {
    particleEffect: 'fireworks', glow: 1.0, jumpStyle: 'staccato', cameraTurn: 'wide-arc',
    velocityResponse: true, pitchColor: true, trailFork: false, idleOrbit: false, landingRipple: true,
    particleDensity: 1.8, ribbonWidth: 1.2, scoreTheme: 'dark-obsidian',
  },
};

function CollapsibleGroup({title, defaultOpen = true, children}: {title: string; defaultOpen?: boolean; children: React.ReactNode}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`inspector-group ${open ? 'is-open' : 'is-collapsed'}`}>
      <button type="button" className="group-title-toggle" onClick={() => setOpen(!open)}>
        <span className="group-title">{title}</span>
        <span className={`group-chevron ${open ? 'is-open' : ''}`}>▾</span>
      </button>
      <div className={`group-body ${open ? 'is-open' : ''}`}>
        {children}
      </div>
    </div>
  );
}

function ToggleRow({label, value, onChange, disabled = false, title}: {
  label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string;
}) {
  return (
    <div className="toggle-row" title={title}>
      <span className="toggle-label">{label}</span>
      <button
        type="button"
        className={`toggle-switch ${value ? 'is-on' : ''}`}
        disabled={disabled}
        onClick={() => onChange(!value)}
        aria-pressed={value}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  );
}


export default function App() {
  const [project, setProject] = useState<ScoreProject>(demo);
  const [scoreFile, setScoreFile] = useState<File | null>(null);
  const [midiFile, setMidiFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [settings, setSettings] = useState<ViewSettings>(() => {
    try {
      return {...defaults, ...JSON.parse(localStorage.getItem('score-motion-settings-v3') || '{}')};
    } catch {
      return defaults;
    }
  });
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState('内置示例已就绪');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingMessage, setRecordingMessage] = useState('整首实时录制 · MP4 / WebM');
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const recordingRef = useRef(false);
  const recorderRef = useRef<ReturnType<typeof beginVideoRecording> | null>(null);
  const recordingTailRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastUiUpdate = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const synthRef = useRef<EnsembleAudio | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => {
    localStorage.setItem('score-motion-settings-v3', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    playingRef.current = false;
    recordingRef.current = false;
    synthRef.current?.pause();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRecordingState('idle');
    setPlaying(false);
    timeRef.current = 0;
    setTime(0);
    synthRef.current?.seek(0);
  }, [project]);

  useEffect(() => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    synthRef.current?.detachMediaElement();
    if (audioFile) {
      audioUrlRef.current = URL.createObjectURL(audioFile);
      audioRef.current = new Audio(audioUrlRef.current);
      synthRef.current?.attachMediaElement(audioRef.current);
    } else {
      audioUrlRef.current = null;
      audioRef.current = null;
    }
    return () => {
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, [audioFile]);

  const seek = useCallback((next: number) => {
    if (recordingRef.current) return;
    const bounded = Math.max(0, Math.min(projectRef.current.duration, next));
    timeRef.current = bounded;
    setTime(bounded);
    synthRef.current?.seek(bounded);
    if (audioRef.current && !synthRef.current) audioRef.current.currentTime = bounded;
  }, []);

  const tone = useCallback((pitch: number, velocity: number, duration: number) => {
    const bus = synthRef.current;
    if (!bus || bus.context.state !== 'running') return;
    const ctx = bus.context;
    const start = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime((.07 * velocity) / 127, start + .014);
    gain.gain.exponentialRampToValueAtTime(.001, start + Math.min(Math.max(duration, .12), 1.5));
    osc.connect(gain).connect(bus.output);
    osc.start(start);
    osc.stop(start + Math.min(Math.max(duration, .12), 1.5) + .02);
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!playingRef.current) {
        last = now;
        return;
      }
      const before = timeRef.current;
      const audioTime = synthRef.current?.currentTime;
      const after = Math.min(
        projectRef.current.duration,
        audioTime !== null && audioTime !== undefined
          ? audioTime
          : before + Math.min((now - last) / 1000, .1) * settingsRef.current.speed
      );
      last = now;
      timeRef.current = after;
      if (!audioRef.current && !synthRef.current?.hasSequencer)
        for (const event of projectRef.current.events)
          if (event.time > before && event.time <= after) tone(event.pitch, event.velocity, event.duration);
      if (now - lastUiUpdate.current > 55) {
        setTime(after);
        lastUiUpdate.current = now;
      }
      if (after >= projectRef.current.duration) {
        playingRef.current = false;
        setPlaying(false);
        if (recordingRef.current) {
          if (recordingTailRef.current) window.clearTimeout(recordingTailRef.current);
          recordingTailRef.current = window.setTimeout(() => recorderRef.current?.stop(), 2000);
        } else synthRef.current?.pause();
        setTime(after);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tone]);

  const getAudioBus = () => {
    synthRef.current ||= new EnsembleAudio();
    if (audioRef.current) synthRef.current.attachMediaElement(audioRef.current);
    return synthRef.current;
  };

  const prepareAudio = async (bus: EnsembleAudio) => {
    const useFullMidi = import.meta.env.DEV && !!project.pianoPartName && !!midiFile && !audioFile;
    if (useFullMidi) await bus.loadMidi(midiFile!);
    if (audioRef.current) bus.attachMediaElement(audioRef.current);
    return useFullMidi;
  };

  const togglePlay = async () => {
    if (recordingRef.current || recordingState === 'preparing' || recordingState === 'finalizing') return;
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      synthRef.current?.pause();
      return;
    }
    if (timeRef.current >= project.duration) seek(0);
    try {
      const bus = getAudioBus();
      const ensemble = await prepareAudio(bus);
      await bus.play(timeRef.current, settings.speed);
      playingRef.current = true;
      setPlaying(true);
      if (!audioRef.current && !ensemble)
        project.events
          .filter(event => Math.abs(event.time - timeRef.current) < .02)
          .forEach(event => tone(event.pitch, event.velocity, event.duration));
      setError('');
    } catch (cause) {
      playingRef.current = false;
      setPlaying(false);
      synthRef.current?.pause();
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // 避免在文本输入、下拉框等表单焦点状态下误触播放开关
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      // Esc 键：退出全屏放大模式
      if (event.key === 'Escape' && expanded) {
        setExpanded(false);
        return;
      }

      // 空格键：控制播放开关（全屏或常规视图下均可按空格键暂停/播放）
      if (event.code === 'Space' || event.key === ' ' || event.keyCode === 32) {
        event.preventDefault();
        void togglePlayRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  const startRecording = async () => {
    if (recordingRef.current) {
      setError('已有录制任务尚未结束。请先取消当前录制。');
      return;
    }
    if (!canvasRef.current) {
      setError('三维曲谱画布尚未就绪。请稍候再录制。');
      return;
    }
    setError('');
    setRecordingState('preparing');
    setRecordingMessage('准备采样音源、音频轨和 30 fps 画面…');
    playingRef.current = false;
    setPlaying(false);
    synthRef.current?.pause();
    try {
      const bus = getAudioBus();
      await prepareAudio(bus);
      const frozenSettings = {...settingsRef.current, speed: 1};
      settingsRef.current = frozenSettings;
      setSettings(frozenSettings);
      timeRef.current = 0;
      setTime(0);
      bus.seek(0);
      const session = beginVideoRecording(
        canvasRef.current,
        bus.audioStream,
        {
          onState: (state, message) => {
            setRecordingState(state);
            if (message) setRecordingMessage(message);
          },
        },
        projectRef.current.title
      );
      recorderRef.current = session;
      recordingRef.current = true;
      void session.completion
        .catch(cause => {
          setRecordingState('error');
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (recordingTailRef.current) window.clearTimeout(recordingTailRef.current);
          recordingTailRef.current = null;
          recordingRef.current = false;
          recorderRef.current = null;
          playingRef.current = false;
          setPlaying(false);
          bus.pause();
        });
      await bus.play(0, 1);
      playingRef.current = true;
      setPlaying(true);
    } catch (cause) {
      recordingRef.current = false;
      recorderRef.current?.cancel();
      recorderRef.current = null;
      setRecordingState('error');
      setRecordingMessage('录制未开始');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const cancelRecording = () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    playingRef.current = false;
    setPlaying(false);
    synthRef.current?.pause();
    recorderRef.current?.cancel();
  };

  const processSelection = async (score: File, midi: File, audio: File | null) => {
    playingRef.current = false;
    setPlaying(false);
    setWorking(true);
    setError('');
    setScoreFile(score);
    setMidiFile(midi);
    setAudioFile(audio);
    try {
      const result = await processFiles(score, midi, setStatus);
      const soundDuration = await audioDuration(audio);
      const title =
        score.name === 'schubert-impromptu.musicxml'
          ? '舒伯特《降A大调即兴曲 D.899 No.4》片段'
          : score.name === 'summer.mxl'
          ? '久石让《Summer》合奏版'
          : result.title;
      setProject({...result, title, duration: Math.max(result.duration, soundDuration)});
      setStatus(
        result.unmatched
          ? `钢琴映射 ${result.pianoMatchedCount || 0}/${result.midiCount} · ${result.unmatched} 音未匹配`
          : '声部映射完成 · 全曲已就绪'
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('处理失败');
    } finally {
      setWorking(false);
    }
  };

  const load = () => {
    if (scoreFile && midiFile) void processSelection(scoreFile, midiFile, audioFile);
  };

  const loadRealExample = async () => {
    setWorking(true);
    setError('');
    setStatus('载入舒伯特示例素材');
    try {
      const base = `${import.meta.env.BASE_URL}examples/real-project/`;
      const read = async (name: string, type: string) => {
        const response = await fetch(`${base}${name}`);
        if (!response.ok) throw new Error(`示例素材读取失败：${name}`);
        return new File([await response.blob()], name, {type});
      };
      const [score, midi, audio] = await Promise.all([
        read('schubert-impromptu.musicxml', 'application/vnd.recordare.musicxml+xml'),
        read('schubert-impromptu.mid', 'audio/midi'),
        read('schubert-impromptu.mp3', 'audio/mpeg'),
      ]);
      await processSelection(score, midi, audio);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('处理失败');
      setWorking(false);
    }
  };

  const loadSummerExample = async () => {
    setWorking(true);
    setError('');
    setStatus('读取《Summer》合奏素材');
    try {
      const base = '/__local_examples/summer/';
      const read = async (name: string, type: string) => {
        const response = await fetch(`${base}${name}`);
        if (!response.ok) throw new Error(`本地示例素材读取失败：${name}（${response.status}）`);
        return new File([await response.blob()], name, {type});
      };
      const [score, midi] = await Promise.all([
        read('summer.mxl', 'application/vnd.recordare.musicxml'),
        read('summer.mid', 'audio/midi'),
      ]);
      await processSelection(score, midi, null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('处理失败');
      setWorking(false);
    }
  };

  const loadProject = async (file: File | null) => {
    if (!file) return;
    try {
      const saved = JSON.parse(await file.text());
      const result = sanitizeProject(saved);
      playingRef.current = false;
      setPlaying(false);
      setProject(result);
      if (saved.settings) setSettings({...defaults, ...saved.settings});
      seek(0);
      setStatus('工程文件已载入');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const update = (key: keyof ViewSettings, value: string | number | boolean) => {
    if (recordingRef.current) return;
    setSettings(previous => ({...previous, [key]: value}));
  };

  const resetDemo = () => {
    playingRef.current = false;
    setPlaying(false);
    setProject(demo);
    seek(0);
    setStatus('内置示例已就绪');
    setError('');
  };

  const matched = project.events.length;
  const percent = project.midiCount ? Math.round((matched / project.midiCount) * 100) : 0;
  const recordingLocked =
    recordingState === 'preparing' || recordingState === 'recording' || recordingState === 'finalizing';
  const displayProject = useMemo(
    () => applyScoreDirection(project, settings.direction),
    [project, settings.direction]
  );

  return (
    <div className={`app-shell theme-${settings.uiTheme || 'studio-dark'}`}>
      {/* 左侧：乐谱与典藏素材侧栏 */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor">
              <circle cx="16" cy="16" r="14" strokeWidth="1.2" strokeOpacity="0.4" />
              <path d="M11 21V9.5l11-2.5V18" strokeWidth="1.6" strokeLinecap="round" />
              <ellipse cx="9" cy="20.5" rx="3" ry="2.2" fill="currentColor" stroke="none" />
              <ellipse cx="19" cy="17.5" rx="3" ry="2.2" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-title">谱面工坊</span>
            <span className="brand-subtitle">SCORE MOTION</span>
          </div>
        </div>

        <div className="side-scroll">
          <div className="section-title">
            <span>曲谱与音源</span>
          </div>
          <p className="side-hint">通过 MusicXML 提取真实符头版面，以 MIDI 音轨驱动时间轴落点。</p>

          <div className="file-stack">
            <FileSlot
              label="MusicXML 曲谱"
              hint="生成真实版面与符头坐标"
              accept=".mxl,.musicxml,.xml"
              file={scoreFile}
              icon={<IconScore />}
              onChange={setScoreFile}
              disabled={recordingLocked}
            />
            <FileSlot
              label="MIDI 音轨"
              hint="提供演奏起音时刻与时值"
              accept=".mid,.midi"
              file={midiFile}
              icon={<IconMidi />}
              onChange={setMidiFile}
              disabled={recordingLocked}
            />
            <FileSlot
              label="演奏实录音频 · 可选"
              hint="WAV / MP3 / OGG 原声同步"
              accept="audio/*,.ogg,.wav,.mp3"
              file={audioFile}
              icon={<IconAudio />}
              onChange={setAudioFile}
              disabled={recordingLocked}
            />
          </div>

          <button
            type="button"
            className="process-button"
            disabled={!scoreFile || !midiFile || working || recordingLocked}
            onClick={load}
          >
            <span>{working ? '正在解析谱面…' : '生成音符动画'}</span>
          </button>

          <div className="divider" />

          <div className="section-title">
            <span>经典乐目</span>
          </div>

          <div className="works-list">
            <button
              type="button"
              className={`work-card ${project.title.includes('舒伯特') ? 'is-active' : ''}`}
              disabled={working || recordingLocked}
              onClick={() => void loadRealExample()}
            >
              <div className="work-meta">
                <span className="work-composer">弗朗茨 · 舒伯特</span>
                <strong className="work-title">降A大调即兴曲</strong>
                <span className="work-spec">D.899 No.4 · 采样钢琴音源</span>
              </div>
            </button>

            {import.meta.env.DEV && (
              <button
                type="button"
                className={`work-card summer-card ${project.title.includes('Summer') ? 'is-active' : ''}`}
                disabled={working || recordingLocked}
                onClick={() => void loadSummerExample()}
              >
                <div className="work-meta">
                  <span className="work-composer">久石让 · 原声重奏</span>
                  <strong className="work-title">《Summer》合奏版</strong>
                  <span className="work-spec">钢琴双手声部 · 完整 MIDI 合成</span>
                </div>
              </button>
            )}
          </div>

          <div className="divider" />

          <div className="section-title">
            <span>工程管理</span>
          </div>

          <div className="action-stack">
            <a
              className="action-link"
              href={`${import.meta.env.BASE_URL}examples/real-project/source-score.pdf`}
              target="_blank"
              rel="noreferrer"
            >
              <IconScore />
              <span>查阅对照乐谱 PDF</span>
            </a>
            <button type="button" className="action-link" disabled={recordingLocked} onClick={resetDemo}>
              <IconReset />
              <span>载入内置基础示例</span>
            </button>
            <label className={`action-link ${recordingLocked ? 'is-disabled' : ''}`}>
              <IconUpload />
              <span>导入工程 JSON</span>
              <input
                type="file"
                accept=".json,application/json"
                disabled={recordingLocked}
                onChange={event => void loadProject(event.target.files?.[0] || null)}
              />
            </label>
            <button
              type="button"
              className="action-link"
              onClick={() => saveFile(`${project.title || 'score-motion'}.json`, JSON.stringify({project, settings}, null, 2))}
            >
              <IconDownload />
              <span>导出工程 JSON</span>
            </button>
          </div>
        </div>

        <div className="sidebar-bottom">
          <span className="bottom-tag">WebGL 3D · 纯本地浏览器处理</span>
        </div>
      </aside>

      {/* 中部：视口优先的主画布与紧凑控制中心 */}
      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <span className="topbar-crumb">当前曲目</span>
            <span className="topbar-divider">/</span>
            <h1 className="topbar-title">{project.title}</h1>
            <span className="topbar-badge">{project.sample ? '内置演示' : `${project.pageCount || 1} 页谱面`}</span>
          </div>
          <div className="topbar-right">
            <div className="topbar-theme-selector" title="快速切换谱面与界面风格">
              <button
                type="button"
                className={`theme-pill ${(settings.scoreTheme || 'classic-ivory') === 'classic-ivory' ? 'is-active' : ''}`}
                onClick={() => update('scoreTheme', 'classic-ivory')}
                title="象牙白谱面（高清晰白纸黑字）"
              >
                象牙白
              </button>
              <button
                type="button"
                className={`theme-pill ${settings.scoreTheme === 'neon-inverted' ? 'is-active' : ''}`}
                onClick={() => update('scoreTheme', 'neon-inverted')}
                title="极夜反色（纯黑发光钛白）"
              >
                极夜
              </button>
              <button
                type="button"
                className={`theme-pill ${settings.scoreTheme === 'dark-obsidian' ? 'is-active' : ''}`}
                onClick={() => update('scoreTheme', 'dark-obsidian')}
                title="乌木暗雕（高对比暗调）"
              >
                暗雕
              </button>
              <button
                type="button"
                className={`theme-pill ${settings.scoreTheme === 'original-vintage' ? 'is-active' : ''}`}
                onClick={() => update('scoreTheme', 'original-vintage')}
                title="原版暖墨（原汁原味初版纸墨）"
              >
                原版
              </button>
              <span className="theme-divider" />
              <button
                type="button"
                className={`theme-pill ui-toggle ${(settings.uiTheme || 'studio-dark') === 'light-studio' ? 'is-active' : ''}`}
                onClick={() => update('uiTheme', settings.uiTheme === 'light-studio' ? 'studio-dark' : 'light-studio')}
                title="切换工作台深色/亮色外观"
              >
                {settings.uiTheme === 'light-studio' ? '深色界面' : '亮色界面'}
              </button>
            </div>

            <span className="status-indicator">
              <i className="status-dot" />
              <span>{status}</span>
            </span>
            <button
              type="button"
              className="export-svg-btn"
              onClick={() => saveFile(`${project.title || 'score-motion'}-score.svg`, displayProject.svg, 'image/svg+xml')}
            >
              <IconDownload />
              <span>导出谱面 SVG</span>
            </button>
          </div>
        </header>

        <div className="workspace-body">
          {error && (
            <div className="error-banner" role="alert">
              <span className="error-icon">!</span>
              <span className="error-text">{error}</span>
              <button type="button" className="error-dismiss" onClick={() => setError('')}>
                关闭
              </button>
            </div>
          )}

          {/* 3D 乐谱画布 */}
          <div className={`stage-viewport ${expanded ? 'is-expanded' : ''}`}>
            <ScoreStage
              project={displayProject}
              timeRef={timeRef}
              settings={settings}
              onCanvasReady={canvas => {
                canvasRef.current = canvas;
              }}
            />
            {settings.vignette ? <div className="stage-vignette" /> : null}
          </div>

          {/* 紧凑整合控制中心 (Transport + Recording + Mapping Ribbon) */}
          <div className="console-dock">
            {/* 播放控制条 */}
            <div className="transport-row">
              <div className="transport-actions">
                <button
                  type="button"
                  className="play-button"
                  disabled={recordingLocked}
                  onClick={() => void togglePlay()}
                  title={playing ? '暂停（空格键）' : '播放（空格键）'}
                  aria-label={playing ? '暂停（空格键）' : '播放（空格键）'}
                >
                  {playing ? <IconPause /> : <IconPlay />}
                </button>
                <button
                  type="button"
                  className="skip-button"
                  disabled={recordingLocked}
                  onClick={() => seek(Math.max(0, time - 5))}
                  title="后退 5 秒"
                  aria-label="后退 5 秒"
                >
                  <IconRewind5 />
                </button>
                <button
                  type="button"
                  className="skip-button"
                  disabled={recordingLocked}
                  onClick={() => seek(Math.min(project.duration, time + 5))}
                  title="前进 5 秒"
                  aria-label="前进 5 秒"
                >
                  <IconForward5 />
                </button>
              </div>

              <div className="scrub-container">
                <input
                  className="timeline-slider"
                  type="range"
                  min="0"
                  max={project.duration || 1}
                  step="0.01"
                  value={time}
                  disabled={recordingLocked}
                  style={{'--progress': `${(time / (project.duration || 1)) * 100}%`} as React.CSSProperties}
                  onChange={event => seek(Number(event.target.value))}
                  aria-label="播放进度"
                />
              </div>

              <div className="timecode-display">
                <span className="time-curr">{fmt(time)}</span>
                <span className="time-sep">/</span>
                <span className="time-total">{fmt(project.duration)}</span>
              </div>

              <button
                type="button"
                className="expand-button"
                disabled={recordingLocked}
                onClick={() => setExpanded(true)}
                title="全屏放大模式（空格播放/暂停 · Esc退出）"
                aria-label="全屏放大模式（空格播放/暂停 · Esc退出）"
              >
                <IconExpand />
              </button>
            </div>

            {/* 录制与双声部映射一体化带 */}
            <div className="dock-ribbon">
              <div className="dock-record-cell">
                <button
                  type="button"
                  className={`record-button ${recordingLocked ? 'is-recording' : ''}`}
                  disabled={working || recordingLocked || !canvasRef.current}
                  onClick={() => void startRecording()}
                >
                  <span className="record-dot" />
                  <span>
                    {recordingState === 'downloaded'
                      ? '再次录制'
                      : recordingState === 'preparing'
                      ? '准备中…'
                      : '录制演奏视频'}
                  </span>
                </button>

                {recordingState === 'recording' && (
                  <button type="button" className="cancel-record" onClick={cancelRecording}>
                    取消
                  </button>
                )}

                <div className="record-status-wrap">
                  <span className="record-message" title={recordingMessage}>{recordingMessage}</span>
                  {recordingLocked && (
                    <div className="record-track-bar">
                      <div style={{width: `${(time / (project.duration || 1)) * 100}%`}} />
                    </div>
                  )}
                </div>
              </div>

              <div className="dock-separator" />

              {/* 紧凑声部与符头匹配概览 */}
              <div className="dock-analysis-cell">
                <div className="match-pill" title={project.pianoPartName ? '钢琴声部起音与谱面符头对应率' : 'MIDI 起音与谱面符头对应率'}>
                  <strong className="match-percent">{percent}%</strong>
                  <div className="match-info">
                    <span className="match-count">{matched} / {project.midiCount || 0} 符头</span>
                    <span className="match-sub">{project.pianoPartName ? '双手声部对应' : '全轨起音对应'}</span>
                  </div>
                </div>

                <div className="voice-lanes">
                  <div className="voice-lane" title="高音声部（右手）时间轴密度">
                    <span className="voice-label" style={{color: settings.violet}}>高音</span>
                    <div className="voice-track">
                      {project.events.filter(e => e.staff === 1).slice(0, 80).map(e => (
                        <i
                          key={e.eventId}
                          className="voice-tick"
                          style={{
                            left: `${(e.time / (project.duration || 1)) * 100}%`,
                            backgroundColor: settings.violet,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="voice-lane" title="低音声部（左手）时间轴密度">
                    <span className="voice-label" style={{color: settings.amber}}>低音</span>
                    <div className="voice-track">
                      {project.events.filter(e => e.staff === 2).slice(0, 80).map(e => (
                        <i
                          key={e.eventId}
                          className="voice-tick"
                          style={{
                            left: `${(e.time / (project.duration || 1)) * 100}%`,
                            backgroundColor: settings.amber,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 右侧：视效与排版参数检查器 */}
      <aside className="inspector">
        <div className="inspector-header">
          <div className="inspector-heading">
            <span className="inspector-title">视效与运镜</span>
            <span className="inspector-subtitle">PROJECTION & STYLE</span>
          </div>
          <select
            className="preset-select"
            value=""
            onChange={e => {
              const p = presets[e.target.value];
              if (p) setSettings(prev => ({...prev, ...p}));
            }}
          >
            <option value="" disabled>一键预设方案...</option>
            {Object.keys(presets).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div className="inspector-scroll">
          <CollapsibleGroup title="谱面呈现风格">
            <div className="segmented-tabs quad-tabs" role="group" aria-label="谱面呈现风格">
              <button
                type="button"
                className={(settings.scoreTheme || 'classic-ivory') === 'classic-ivory' ? 'is-active' : ''}
                disabled={recordingLocked}
                onClick={() => update('scoreTheme', 'classic-ivory')}
              >
                象牙白谱
              </button>
              <button
                type="button"
                className={settings.scoreTheme === 'neon-inverted' ? 'is-active' : ''}
                disabled={recordingLocked}
                onClick={() => update('scoreTheme', 'neon-inverted')}
              >
                极夜反色
              </button>
              <button
                type="button"
                className={settings.scoreTheme === 'dark-obsidian' ? 'is-active' : ''}
                disabled={recordingLocked}
                onClick={() => update('scoreTheme', 'dark-obsidian')}
              >
                乌木暗雕
              </button>
              <button
                type="button"
                className={settings.scoreTheme === 'original-vintage' ? 'is-active' : ''}
                disabled={recordingLocked}
                onClick={() => update('scoreTheme', 'original-vintage')}
              >
                原版暖墨
              </button>
            </div>
          </CollapsibleGroup>

          <CollapsibleGroup title="界面配色主题">
            <div className="segmented-tabs triple-tabs" role="group" aria-label="界面配色主题">
              <button
                type="button"
                className={(settings.uiTheme || 'studio-dark') === 'studio-dark' ? 'is-active' : ''}
                disabled={recordingLocked}
                onClick={() => update('uiTheme', 'studio-dark')}
              >
                专业深色
              </button>
              <button
                type="button"
                className={settings.uiTheme === 'classical-ink' ? 'is-active' : ''}
                disabled={recordingLocked}
                onClick={() => update('uiTheme', 'classical-ink')}
              >
                典雅墨金
              </button>
              <button
                type="button"
                className={settings.uiTheme === 'light-studio' ? 'is-active' : ''}
                disabled={recordingLocked}
                onClick={() => update('uiTheme', 'light-studio')}
              >
                明亮工坊
              </button>
            </div>
          </CollapsibleGroup>

          <CollapsibleGroup title="画面纯净度（暗角遮罩）">
            <div className="segmented-tabs" role="group" aria-label="画面纯净度">
              <button
                type="button"
                className={!settings.vignette ? 'is-active' : ''}
                disabled={recordingLocked}
                onClick={() => update('vignette', 0)}
              >
                通透纯净
              </button>
              <button
                type="button"
                className={settings.vignette ? 'is-active' : ''}
                disabled={recordingLocked}
                onClick={() => update('vignette', 1)}
              >
                舞台微晕
              </button>
            </div>
          </CollapsibleGroup>

          <CollapsibleGroup title="转折换行运镜">
            <div className="segmented-tabs triple-tabs" role="group" aria-label="转折换行运镜">
              <button
                type="button"
                className={(settings.cameraTurn || 'wide-arc') === 'wide-arc' ? 'is-active' : ''}
                disabled={recordingLocked}
                onClick={() => update('cameraTurn', 'wide-arc')}
                title="大圆弧缓冲预瞄（默认推荐，平滑大弯角）"
              >
                大弧缓冲
              </button>
              <button
                type="button"
                className={settings.cameraTurn === 'cinematic' ? 'is-active' : ''}
                disabled={recordingLocked}
                onClick={() => update('cameraTurn', 'cinematic')}
                title="升维广角缓转（换行时微拉远视野平缓扫谱）"
              >
                升维广角
              </button>
              <button
                type="button"
                className={settings.cameraTurn === 'constant-glide' ? 'is-active' : ''}
                disabled={recordingLocked}
                onClick={() => update('cameraTurn', 'constant-glide')}
                title="匀速平移滑行（锁定速度平缓绕弯）"
              >
                匀速滑移
              </button>
            </div>
          </CollapsibleGroup>

          <CollapsibleGroup title="音符跳跃风格">
            <div className="jump-grid" role="group" aria-label="音符跳跃风格">
              <button
                type="button"
                className={`jump-btn ${(settings.jumpStyle || 'elastic') === 'elastic' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('jumpStyle', 'elastic')}
              >
                <strong>Q弹律动</strong>
                <small>微弹形变</small>
              </button>
              <button
                type="button"
                className={`jump-btn ${settings.jumpStyle === 'fluid' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('jumpStyle', 'fluid')}
              >
                <strong>优雅流光</strong>
                <small>长弧丝带</small>
              </button>
              <button
                type="button"
                className={`jump-btn ${settings.jumpStyle === 'staccato' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('jumpStyle', 'staccato')}
              >
                <strong>敏捷顿音</strong>
                <small>清脆打击</small>
              </button>
              <button
                type="button"
                className={`jump-btn ${settings.jumpStyle === 'comet' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('jumpStyle', 'comet')}
              >
                <strong>彗星脉冲</strong>
                <small>光芒脉冲</small>
              </button>
              <button
                type="button"
                className={`jump-btn ${settings.jumpStyle === 'float' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('jumpStyle', 'float')}
              >
                <strong>浮空漫步</strong>
                <small>低空漂浮</small>
              </button>
            </div>
          </CollapsibleGroup>

          <CollapsibleGroup title="弹跳动力学微调">
            <Slider
              label="起跳高度倍率"
              value={settings.jumpHeight || 1.0}
              min={0.5}
              max={2.0}
              step={0.05}
              display={`${(settings.jumpHeight || 1.0).toFixed(2)}×`}
              onChange={v => update('jumpHeight', v)}
              disabled={recordingLocked}
            />
            <Slider
              label="落地弹性微回弹"
              value={settings.bounciness !== undefined ? settings.bounciness : 1.0}
              min={0}
              max={1.5}
              step={0.05}
              display={`${Math.round((settings.bounciness !== undefined ? settings.bounciness : 1.0) * 100)}%`}
              onChange={v => update('bounciness', v)}
              disabled={recordingLocked}
            />
          </CollapsibleGroup>

          <CollapsibleGroup title="伴生光效与粒子">
            <div className="jump-grid" role="group" aria-label="伴生光效模式">
              <button
                type="button"
                className={`jump-btn ${(settings.particleEffect || 'all') === 'all' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('particleEffect', 'all')}
              >
                <strong>全部华丽</strong>
                <small>碎星·彩带·乐符</small>
              </button>
              <button
                type="button"
                className={`jump-btn ${settings.particleEffect === 'stardust' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('particleEffect', 'stardust')}
              >
                <strong>璀璨星尘</strong>
                <small>微芒碎星+落地爆点</small>
              </button>
              <button
                type="button"
                className={`jump-btn ${settings.particleEffect === 'ribbon' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('particleEffect', 'ribbon')}
              >
                <strong>流光彩带</strong>
                <small>聚焦立体宽幅彩带</small>
              </button>
              <button
                type="button"
                className={`jump-btn ${settings.particleEffect === 'notes' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('particleEffect', 'notes')}
              >
                <strong>乐符微尘</strong>
                <small>伴生♪音符轻飏</small>
              </button>
              <button
                type="button"
                className={`jump-btn ${settings.particleEffect === 'minimal' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('particleEffect', 'minimal')}
              >
                <strong>纯净流线</strong>
                <small>极简无颗粒</small>
              </button>
              <button
                type="button"
                className={`jump-btn ${settings.particleEffect === 'aurora' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('particleEffect', 'aurora')}
              >
                <strong>极光幻彩</strong>
                <small>彩虹渐变流动拖尾</small>
              </button>
              <button
                type="button"
                className={`jump-btn ${settings.particleEffect === 'firefly' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('particleEffect', 'firefly')}
              >
                <strong>萤火追踪</strong>
                <small>暖色脉冲萤光飘散</small>
              </button>
              <button
                type="button"
                className={`jump-btn ${settings.particleEffect === 'fireworks' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('particleEffect', 'fireworks')}
              >
                <strong>烟花绽放</strong>
                <small>落地多层烟花级联</small>
              </button>
              <button
                type="button"
                className={`jump-btn ${settings.particleEffect === 'inkwash' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('particleEffect', 'inkwash')}
              >
                <strong>水墨晕染</strong>
                <small>中国画墨韵扩散</small>
              </button>
              <button
                type="button"
                className={`jump-btn ${settings.particleEffect === 'lightning' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('particleEffect', 'lightning')}
              >
                <strong>电光脉冲</strong>
                <small>高频电弧闪烁迸发</small>
              </button>
              <button
                type="button"
                className={`jump-btn ${settings.particleEffect === 'bubbles' ? 'is-active' : ''}`}
                disabled={recordingLocked}
                onClick={() => update('particleEffect', 'bubbles')}
              >
                <strong>气泡升腾</strong>
                <small>虹彩气泡梦幻上浮</small>
              </button>
            </div>
            <Slider
              label="粒子迸发浓度"
              value={settings.particleDensity !== undefined ? settings.particleDensity : 1.0}
              min={0.2}
              max={2.0}
              step={0.1}
              display={`${Math.round((settings.particleDensity !== undefined ? settings.particleDensity : 1.0) * 100)}%`}
              onChange={v => update('particleDensity', v)}
              disabled={recordingLocked || settings.particleEffect === 'minimal'}
            />
            <Slider
              label="流光彩带宽度"
              value={settings.ribbonWidth !== undefined ? settings.ribbonWidth : 1.2}
              min={0.5}
              max={2.5}
              step={0.1}
              display={`${(settings.ribbonWidth !== undefined ? settings.ribbonWidth : 1.2).toFixed(1)}×`}
              onChange={v => update('ribbonWidth', v)}
              disabled={recordingLocked}
            />
          </CollapsibleGroup>

          <CollapsibleGroup title="光效层次增强" defaultOpen={true}>
            <ToggleRow
              label="力度响应"
              title="粒子密度和爆发强度跟随MIDI力度动态变化"
              value={settings.velocityResponse !== false}
              onChange={v => update('velocityResponse', v)}
              disabled={recordingLocked}
            />
            <ToggleRow
              label="音高色谱"
              title="粒子颜色叠加音高色温映射，低音偏暖红、高音偏冷蓝"
              value={settings.pitchColor === true}
              onChange={v => update('pitchColor', v)}
              disabled={recordingLocked}
            />
            <ToggleRow
              label="尾迹分叉"
              title="飞行彩带末端分裂为2条渐隐细丝，增添层次"
              value={settings.trailFork === true}
              onChange={v => update('trailFork', v)}
              disabled={recordingLocked}
            />
            <ToggleRow
              label="待机光环"
              title="球停驻时周围环绕微光轨道粒子"
              value={settings.idleOrbit !== false}
              onChange={v => update('idleOrbit', v)}
              disabled={recordingLocked}
            />
            <ToggleRow
              label="落地涟漪"
              title="着地时产生同心扩散光环水纹"
              value={settings.landingRipple !== false}
              onChange={v => update('landingRipple', v)}
              disabled={recordingLocked}
            />
          </CollapsibleGroup>

          <CollapsibleGroup title="乐谱排列方式">
            <div className="segmented-tabs" role="group" aria-label="曲谱排列方式">
              <button
                type="button"
                className={settings.direction === 'serpentine' ? 'is-active' : ''}
                disabled={recordingLocked}
                onClick={() => update('direction', 'serpentine')}
              >
                蛇形折返
              </button>
              <button
                type="button"
                className={settings.direction === 'standard' ? 'is-active' : ''}
                disabled={recordingLocked}
                onClick={() => update('direction', 'standard')}
              >
                传统单向
              </button>
            </div>
          </CollapsibleGroup>

          <CollapsibleGroup title="运镜景深">
            <Slider
              label="镜头视距"
              value={settings.cameraDistance}
              min={.22}
              max={1.1}
              step={.01}
              display={`${Math.round(settings.cameraDistance * 100)}%`}
              onChange={v => update('cameraDistance', v)}
              disabled={recordingLocked}
            />
            <Slider
              label="音符跟随"
              value={settings.follow}
              min={0}
              max={1}
              step={.01}
              display={`${Math.round(settings.follow * 100)}%`}
              onChange={v => update('follow', v)}
              disabled={recordingLocked}
            />
          </CollapsibleGroup>

          <CollapsibleGroup title="光影与声部色彩">
            <Slider
              label="符头辉光"
              value={settings.glow}
              min={0}
              max={1.5}
              step={.01}
              display={`${Math.round(settings.glow * 100)}%`}
              onChange={v => update('glow', v)}
              disabled={recordingLocked}
            />
            <div className="color-swatches">
              <label className="color-swatch-cell">
                <span className="color-name">高音声部</span>
                <div className="swatch-wrap">
                  <span className="swatch-circle" style={{backgroundColor: settings.violet}} />
                  <span className="swatch-val">{settings.violet}</span>
                  <input
                    type="color"
                    disabled={recordingLocked}
                    value={settings.violet}
                    onChange={e => update('violet', e.target.value)}
                  />
                </div>
              </label>
              <label className="color-swatch-cell">
                <span className="color-name">低音声部</span>
                <div className="swatch-wrap">
                  <span className="swatch-circle" style={{backgroundColor: settings.amber}} />
                  <span className="swatch-val">{settings.amber}</span>
                  <input
                    type="color"
                    disabled={recordingLocked}
                    value={settings.amber}
                    onChange={e => update('amber', e.target.value)}
                  />
                </div>
              </label>
            </div>
          </CollapsibleGroup>

          <CollapsibleGroup title="回放节奏">
            <Slider
              label="预览倍速"
              value={settings.speed}
              min={.5}
              max={1.5}
              step={.05}
              display={`${settings.speed.toFixed(2)}×`}
              onChange={v => update('speed', v)}
              disabled={recordingLocked}
            />
          </CollapsibleGroup>

          <div className="inspector-note">
            <p>录制视频时将自动锁定当前视角与光色参数，以确保 30 fps 连续帧稳定导出。</p>
          </div>
        </div>

        <div className="inspector-footer">
          <span className="status-dot" />
          <span className="footer-status-text">{status}</span>
        </div>
      </aside>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`slider-control ${disabled ? 'is-disabled' : ''}`}>
      <span className="slider-header">
        <span className="slider-label">{label}</span>
        <span className="slider-val">{display}</span>
      </span>
      <input
        type="range"
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{'--progress': `${((value - min) / (max - min)) * 100}%`} as React.CSSProperties}
        onChange={e => onChange(Number(e.target.value))}
      />
    </label>
  );
}
