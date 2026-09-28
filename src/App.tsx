import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {demo} from './demo';
import {processFiles} from './scoreProcessor';
import {applyScoreDirection} from './scoreLayout';
import {ScoreStage} from './ScoreStage';
import {EnsembleAudio} from './ensembleAudio';
import {beginVideoRecording} from './videoRecorder';
import type {RecordingState} from './videoRecorder';
import type {ScoreProject, ViewSettings} from './types';

const defaults: ViewSettings = {direction: 'serpentine', cameraDistance: .44, glow: .85, follow: .94, speed: 1, violet: '#bda0ff', amber: '#ffbc6d'};
const fmt = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
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
    const finish = (duration: number) => { audio.src = ''; URL.revokeObjectURL(url); resolve(duration); };
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => finish(0);
    audio.preload = 'metadata';
    audio.src = url;
  });
}

function sanitizeProject(value: unknown): ScoreProject {
  const p = (value as {project?: ScoreProject})?.project || value as Partial<ScoreProject>;
  if (!p || typeof p.svg !== 'string' || !Array.isArray(p.events) || !p.events.length || !Number.isFinite(p.width) || !Number.isFinite(p.height) || !Number.isFinite(p.duration)) throw new Error('项目 JSON 缺少曲谱或事件。');
  const xml = new DOMParser().parseFromString(p.svg, 'image/svg+xml');
  if (xml.querySelector('parsererror') || xml.documentElement.tagName.toLowerCase() !== 'svg') throw new Error('项目中的 SVG 无效。');
  xml.querySelectorAll('script,foreignObject,iframe,object').forEach(node => node.remove());
  xml.querySelectorAll('*').forEach(node => {
    for (const attr of [...node.attributes]) if (/^on/i.test(attr.name) || (/href$/i.test(attr.name) && !attr.value.startsWith('#'))) node.removeAttribute(attr.name);
  });
  return {...p, svg: new XMLSerializer().serializeToString(xml.documentElement)} as ScoreProject;
}

function FileSlot({label, hint, accept, file, onChange, disabled = false}: {label: string; hint: string; accept: string; file: File | null; onChange: (file: File | null) => void; disabled?: boolean}) {
  return <label className={`file-slot ${file ? 'has-file' : ''}`}>
    <span className="file-icon">{file ? '✓' : '+'}</span>
    <span className="file-copy"><strong>{file ? file.name : label}</strong><small>{file ? `${(file.size / 1024).toFixed(1)} KB · 点击替换` : hint}</small></span>
    <input type="file" accept={accept} disabled={disabled} onChange={event => onChange(event.target.files?.[0] || null)} />
  </label>;
}

export default function App() {
  const [project, setProject] = useState<ScoreProject>(demo);
  const [scoreFile, setScoreFile] = useState<File | null>(null);
  const [midiFile, setMidiFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [settings, setSettings] = useState<ViewSettings>(() => {
    try { return {...defaults, ...JSON.parse(localStorage.getItem('score-motion-settings-v3') || '{}')}; }
    catch { return defaults; }
  });
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState('内置示例已就绪');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingMessage, setRecordingMessage] = useState('整首实时录制 · MP4 优先，不支持时使用 WebM');
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

  useEffect(() => { localStorage.setItem('score-motion-settings-v3', JSON.stringify(settings)); }, [settings]);
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
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);
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
    gain.gain.linearRampToValueAtTime(.07 * velocity / 127, start + .014);
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
      if (!playingRef.current) { last = now; return; }
      const before = timeRef.current;
      const audioTime = synthRef.current?.currentTime;
      const after = Math.min(projectRef.current.duration, audioTime !== null && audioTime !== undefined
        ? audioTime : before + Math.min((now - last) / 1000, .1) * settingsRef.current.speed);
      last = now;
      timeRef.current = after;
      if (!audioRef.current && !synthRef.current?.hasSequencer) for (const event of projectRef.current.events) if (event.time > before && event.time <= after) tone(event.pitch, event.velocity, event.duration);
      if (now - lastUiUpdate.current > 55) { setTime(after); lastUiUpdate.current = now; }
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
      if (!audioRef.current && !ensemble) project.events.filter(event => Math.abs(event.time - timeRef.current) < .02).forEach(event => tone(event.pitch, event.velocity, event.duration));
      setError('');
    } catch (cause) {
      playingRef.current = false;
      setPlaying(false);
      synthRef.current?.pause();
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const startRecording = async () => {
    if (recordingRef.current) { setError('已有录制任务尚未结束。请先取消当前录制。'); return; }
    if (!canvasRef.current) { setError('三维曲谱画布尚未就绪。请稍候再录制。'); return; }
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
      const session = beginVideoRecording(canvasRef.current, bus.audioStream, {
        onState: (state, message) => {
          setRecordingState(state);
          if (message) setRecordingMessage(message);
        },
      }, projectRef.current.title);
      recorderRef.current = session;
      recordingRef.current = true;
      void session.completion.catch(cause => {
        setRecordingState('error');
        setError(cause instanceof Error ? cause.message : String(cause));
      }).finally(() => {
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
      const title = score.name === 'schubert-impromptu.musicxml' ? '舒伯特《降A大调即兴曲 D.899 No.4》片段'
        : score.name === 'summer.mxl' ? '久石让《Summer》合奏版' : result.title;
      setProject({...result, title, duration: Math.max(result.duration, soundDuration)});
      setStatus(result.unmatched ? `钢琴映射 ${result.pianoMatchedCount || 0}/${result.midiCount} · ${result.unmatched} 个钢琴音未匹配`
        : '钢琴声部映射完成 · 全曲合奏已就绪');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('处理失败');
    } finally { setWorking(false); }
  };

  const load = () => { if (scoreFile && midiFile) void processSelection(scoreFile, midiFile, audioFile); };

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
    setStatus('读取本地《Summer》合奏素材');
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
      setStatus('项目文件已载入');
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const update = (key: keyof ViewSettings, value: string | number) => { if (recordingRef.current) return; setSettings(previous => ({...previous, [key]: value})); };
  const resetDemo = () => { playingRef.current = false; setPlaying(false); setProject(demo); seek(0); setStatus('内置示例已就绪'); setError(''); };
  const matched = project.events.length;
  const percent = project.midiCount ? Math.round(matched / project.midiCount * 100) : 0;
  const recordingLocked = recordingState === 'preparing' || recordingState === 'recording' || recordingState === 'finalizing';
  const displayProject = useMemo(() => applyScoreDirection(project, settings.direction), [project, settings.direction]);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">♪</div><div><strong>谱面</strong><span>SCORE MOTION STUDIO</span></div></div>
      <div className="side-scroll">
        <div className="section-heading"><span>素材</span><small>01 / INPUT</small></div>
        <p className="side-description">上传同一版本的曲谱与 MIDI。谱面给出落点，MIDI 给出演奏时刻。</p>
        <div className="file-stack">
          <FileSlot label="MXL / MusicXML 曲谱" hint="用于生成真实谱面与符头坐标" accept=".mxl,.musicxml,.xml" file={scoreFile} onChange={setScoreFile} disabled={recordingLocked} />
          <FileSlot label="MIDI 文件" hint="用于音符与时间轴" accept=".mid,.midi" file={midiFile} onChange={setMidiFile} disabled={recordingLocked} />
          <FileSlot label="演奏音频 · 可选" hint="WAV / MP3 / OGG，需自行确认同步" accept="audio/*,.ogg,.wav,.mp3" file={audioFile} onChange={setAudioFile} disabled={recordingLocked} />
        </div>
        <button className="process-button" disabled={!scoreFile || !midiFile || working || recordingLocked} onClick={load}>{working ? '正在处理…' : '生成曲谱动画'}<span>↗</span></button>
        <div className="divider" />
        <div className="section-heading"><span>项目</span><small>02 / PROJECT</small></div>
        <button className="real-example-button" disabled={working || recordingLocked} onClick={() => void loadRealExample()}><span>♫</span><strong>载入真实曲目</strong><small>舒伯特 · 演奏转录 · 采样钢琴</small><i>↗</i></button>
        {import.meta.env.DEV && <button className="real-example-button summer-example-button" disabled={working || recordingLocked} onClick={() => void loadSummerExample()}><span>♫</span><strong>久石让《Summer》合奏版</strong><small>完整 MIDI 合奏 · 钢琴双手动画 · 本地预览</small><i>↗</i></button>}
        <a className="text-action" href={`${import.meta.env.BASE_URL}examples/real-project/source-score.pdf`} target="_blank" rel="noreferrer"><span>▧</span>查看来源乐谱 PDF</a>
        <button className="text-action" disabled={recordingLocked} onClick={resetDemo}><span>◌</span> 查看内置示例</button>
        <label className={`text-action ${recordingLocked ? 'is-disabled' : ''}`}><span>↥</span> 导入项目 JSON<input type="file" accept=".json,application/json" disabled={recordingLocked} onChange={event => void loadProject(event.target.files?.[0] || null)} /></label>
        <button className="text-action" onClick={() => saveFile(`${project.title || 'score-motion'}.json`, JSON.stringify({project, settings}, null, 2))}><span>↧</span> 保存项目 JSON</button>
        <div className="tip-card"><strong>关于匹配</strong><p>当前自动匹配按音高和拍位进行。反复、移调、倚音或不同版本可能需要人工校对；右侧会显示未匹配数量。</p></div>
      </div>
      <div className="sidebar-bottom"><span className="status-dot" />本地浏览器处理 <span>v0.1</span></div>
    </aside>

    <main className="workspace">
      <header className="topbar"><div className="breadcrumbs">工作台 <span>/</span> <strong>{project.sample ? '示例项目' : project.title}</strong></div><div className="top-actions"><span className="saved-indicator">● 自动保存参数</span><button onClick={() => saveFile('score-motion-score.svg', displayProject.svg, 'image/svg+xml')}>导出谱面 SVG ↗</button></div></header>
      <div className="workspace-content">
        <div className="page-intro"><div><div className="eyebrow">MUSIC VISUALIZATION WORKBENCH</div><h1>让曲谱被演奏。</h1><p>用真实符头位置和 MIDI 时间轴，制作沿纸面行进的音符动画。</p></div><div className="project-tag">{project.sample ? '示例预览' : `${project.pageCount} 页曲谱`}</div></div>
        {error && <div className="error-banner" role="alert"><span>!</span>{error}<button onClick={() => setError('')}>关闭</button></div>}
        <section className="preview-panel">
          <div className="panel-top"><div><span className="live-dot" />实时预览 <span className="preview-separator">/</span><strong>{project.title}</strong></div><div className="preview-tools"><span className="preview-hint">3D CAMERA <span>·</span> MIDI DRIVEN</span><button type="button" className="fullscreen-button" disabled={recordingLocked} onClick={() => setExpanded(true)} aria-label="放大预览">⛶ <span>放大</span></button></div></div>
          <div className={`stage-wrap ${expanded ? 'is-expanded' : ''}`}><ScoreStage project={displayProject} timeRef={timeRef} settings={settings} onCanvasReady={canvas => { canvasRef.current = canvas; }} /><div className="stage-vignette" /><div className="stage-corner stage-corner-tl"/><div className="stage-corner stage-corner-br"/><span className="stage-label">{project.sample ? 'SAMPLE SCENE' : 'LIVE SCORE'}</span><span className="stage-time">{fmt(time)} <i>/</i> {fmt(project.duration)}</span>{expanded && <button className="expanded-close" onClick={() => setExpanded(false)}>退出放大 <span>Esc</span></button>}</div>
          <div className="transport"><button className="play-button" disabled={recordingLocked} onClick={() => void togglePlay()} aria-label={playing ? '暂停' : '播放'}>{playing ? 'Ⅱ' : '▶'}</button><button className="skip-button" disabled={recordingLocked} onClick={() => seek(Math.max(0, time - 5))} aria-label="后退五秒">↶ 5</button><input className="timeline" type="range" min="0" max={project.duration} step="0.01" value={time} disabled={recordingLocked} style={{'--progress': `${time / project.duration * 100}%`} as React.CSSProperties} onChange={event => seek(Number(event.target.value))} aria-label="播放位置"/><button className="skip-button" disabled={recordingLocked} onClick={() => seek(Math.min(project.duration, time + 5))} aria-label="前进五秒">5 ↷</button><span className="transport-time">{fmt(time)} / {fmt(project.duration)}</span></div>
            <div className="record-bar"><button type="button" className={`record-button ${recordingLocked ? 'is-recording' : ''}`} disabled={working || recordingLocked || !canvasRef.current} onClick={() => void startRecording()}><span className="record-dot" />{recordingState === 'downloaded' ? '再次录制整首' : recordingState === 'preparing' ? '准备中…' : '录制整首'}</button><div className="recording-info"><strong>{fmt(time)} / {fmt(project.duration)}</strong><span>{recordingMessage}</span></div><div className="recording-progress" role="progressbar" aria-label="录制进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={recordingLocked ? Math.round(time / project.duration * 100) : 0}><i style={{width: `${recordingLocked ? time / project.duration * 100 : recordingState === 'downloaded' ? 100 : 0}%`}} /></div>{recordingState === 'recording' && <button type="button" className="cancel-recording" onClick={cancelRecording}>取消</button>}</div>
        </section>
        <div className="info-grid"><section className="info-card"><div className="card-heading">映射检查 <span>DATA INTEGRITY</span></div><div className="mapping-row"><strong>{percent}<small>%</small></strong><div><b>{matched} / {project.midiCount}</b><span>{project.pianoPartName ? '钢琴 MIDI 起音对应到符头' : ' MIDI 起音对应到符头'}</span></div></div><div className="meter"><span style={{width: `${percent}%`}} /></div><p>{project.pianoPartName ? `${project.pianoPartName} · ${project.partCount} 个 MusicXML 编组 · ${project.pianoTrackNames?.join(' / ')} · ${project.soundingTrackCount} 条有音轨完整合奏。${project.unmatched ? ` ${project.unmatched} 个钢琴音未匹配，请核对编配。` : ''}` : project.sample ? '内置示例数据，仅用于体验画面与控制。' : project.unmatched ? `${project.unmatched} 个未匹配，导出前请检查曲谱与 MIDI 是否为同一版本。` : '所有 MIDI 起音都已匹配，建议逐段核对落点。'}</p></section><section className="info-card"><div className="card-heading">时间轴 <span>SEQUENCE</span></div><div className="sequence-track"><span>高音 / 紫</span><div>{project.events.filter(e => e.staff === 1).slice(0, 80).map(e => <i key={e.eventId} className="upper-tick" style={{left: `${e.time / project.duration * 100}%`}} />)}</div></div><div className="sequence-track"><span>低音 / 橙</span><div>{project.events.filter(e => e.staff === 2).slice(0, 80).map(e => <i key={e.eventId} className="lower-tick" style={{left: `${e.time / project.duration * 100}%`}} />)}</div></div><p>{audioFile?.name === 'schubert-impromptu.mp3' ? '采样钢琴音频对应随附 MIDI；片尾保留自然衰减。' : audioFile ? `使用 ${audioFile.name} 试听；请自行核验与 MIDI 的同步。` : project.pianoPartName ? `完整 MIDI 经本地采样音源合成，播放全部 ${project.midiTrackCount} 条轨道。` : '试听为浏览器合成音；可添加与曲谱同步的音频。'}</p></section></div>
      </div>
    </main>

    <aside className="inspector"><div className="inspector-header"><strong>画面调节</strong><span>CONTROLS</span></div><div className="inspector-scroll"><p className="inspector-lead">录制中会锁定方向、镜头和光色参数，保证导出画面连续。</p><div className="control-section"><h3>曲谱方向</h3><div className="direction-options" role="group" aria-label="曲谱方向"><button type="button" className={settings.direction === 'serpentine' ? 'is-active' : ''} disabled={recordingLocked} aria-pressed={settings.direction === 'serpentine'} onClick={() => update('direction', 'serpentine')}>蛇形</button><button type="button" className={settings.direction === 'standard' ? 'is-active' : ''} disabled={recordingLocked} aria-pressed={settings.direction === 'standard'} onClick={() => update('direction', 'standard')}>标准</button></div></div><div className="control-section"><h3>镜头</h3><Slider label="镜头距离" value={settings.cameraDistance} min={.22} max={1.1} step={.01} display={`${Math.round(settings.cameraDistance * 100)}%`} onChange={v => update('cameraDistance', v)} disabled={recordingLocked} /><Slider label="跟随强度" value={settings.follow} min={0} max={1} step={.01} display={`${Math.round(settings.follow * 100)}%`} onChange={v => update('follow', v)} disabled={recordingLocked} /></div><div className="control-section"><h3>光与色彩</h3><Slider label="柔光强度" value={settings.glow} min={0} max={1.5} step={.01} display={`${Math.round(settings.glow * 100)}%`} onChange={v => update('glow', v)} disabled={recordingLocked} /><div className="color-row"><label><span>高音声部</span><input type="color" disabled={recordingLocked} value={settings.violet} onChange={e => update('violet', e.target.value)} /></label><label><span>低音声部</span><input type="color" disabled={recordingLocked} value={settings.amber} onChange={e => update('amber', e.target.value)} /></label></div></div><div className="control-section"><h3>播放</h3><Slider label="预览速度" value={settings.speed} min={.5} max={1.5} step={.05} display={`${settings.speed.toFixed(2)}×`} onChange={v => update('speed', v)} disabled={recordingLocked} /></div><div className="inspector-note"><span>ⓘ</span><p>曲谱素材仅通过本地开发入口提供。整首录制需要实时播放约 4 分钟，导出格式以浏览器实际支持为准。</p></div></div><div className="inspector-footer"><span className="status-dot" />{status}</div></aside>
  </div>;
}

function Slider({label, value, min, max, step, display, onChange, disabled = false}: {label: string; value: number; min: number; max: number; step: number; display: string; onChange: (n: number) => void; disabled?: boolean}) {
  return <label className={`slider-control ${disabled ? 'is-disabled' : ''}`}><span><b>{label}</b><small>{display}</small></span><input type="range" disabled={disabled} min={min} max={max} step={step} value={value} style={{'--progress': `${(value - min) / (max - min) * 100}%`} as React.CSSProperties} onChange={e => onChange(Number(e.target.value))}/></label>;
}
