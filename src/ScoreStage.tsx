import {useEffect, useRef} from 'react';
import * as THREE from 'three';
import {arcPoint, groupLandings, performanceAt, scorePathPoint, SCORE_SCALE} from './performance';
import type {Activation, CameraTurn, ScoreProject, ScoreTheme, ViewSettings} from './types';

type Props = {project: ScoreProject; timeRef: React.RefObject<number>; settings: ViewSettings; onCanvasReady?: (canvas: HTMLCanvasElement | null) => void};
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

type CameraKey = {time: number; x: number; y: number; system: number};
function cameraKeys(events: Activation[]): CameraKey[] {
  const upper = groupLandings(events, 1);
  const lower = groupLandings(events, 2);
  const times = [...new Set(events.map(event => event.time))].sort((a, b) => a - b);
  let u = -1;
  let l = -1;
  return times.map(time => {
    while (u + 1 < upper.length && upper[u + 1].time <= time + 1e-5) u++;
    while (l + 1 < lower.length && lower[l + 1].time <= time + 1e-5) l++;
    const a = upper[u];
    const b = lower[l];
    const latest = a && b ? (a.time >= b.time ? a : b) : (a || b);
    const sameSystem = !!a && !!b && a.system === b.system;
    const x = sameSystem ? .55 * a!.x + .45 * b!.x : latest.x;
    const y = sameSystem ? (a!.y + b!.y) / 2 : latest.y;
    return {time, x, y, system: latest.system};
  });
}

function cameraAt(keys: CameraKey[], time: number, cameraTurn: CameraTurn = 'wide-arc') {
  if (keys.length === 1 || time <= keys[0].time) return {key: keys[0], isTransition: false, progress: 0};
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle].time < time) low = middle + 1;
    else high = middle;
  }
  const i = Math.max(0, low - 1);
  if (i + 1 >= keys.length) return {key: keys.at(-1)!, isTransition: false, progress: 1};
  const a = keys[i], b = keys[i + 1];
  const progress = clamp((time - a.time) / (b.time - a.time), 0, 1);
  const isTransition = a.system !== b.system;
  const [x, y] = scorePathPoint(a, b, progress, cameraTurn);
  return {key: {time, x, y, system: b.system}, isTransition, progress};
}

function gradePaper(ctx: CanvasRenderingContext2D, width: number, height: number, theme: ScoreTheme = 'classic-ivory') {
  const pixels = ctx.getImageData(0, 0, width, height);
  const data = pixels.data;
  if (theme === 'classic-ivory') {
    // 象牙白经典乐谱：高透亮温润白纸，符头五线谱纯黑锐利，黑白分明极致清晰
    for (let i = 0; i < data.length; i += 4) {
      const lum = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
      const factor = clamp(lum / 235, 0, 1);
      data[i] = Math.round(18 + factor * 234);
      data[i + 1] = Math.round(17 + factor * 233);
      data[i + 2] = Math.round(16 + factor * 228);
    }
  } else if (theme === 'neon-inverted') {
    // 极夜夜光反色：底纸深黑，五线谱与符头呈高光钛白，无灰雾杂质
    for (let i = 0; i < data.length; i += 4) {
      const lum = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
      const inv = clamp((252 - lum) / 200, 0, 1);
      data[i] = Math.round(10 + inv * 242);
      data[i + 1] = Math.round(10 + inv * 242);
      data[i + 2] = Math.round(14 + inv * 242);
    }
  } else if (theme === 'original-vintage') {
    // 原版暖墨复古：原汁原味还原初版沉浸微灰墨色与暖调纸质
    for (let i = 0; i < data.length; i += 4) {
      const value = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
      const normalized = clamp((value - 20) / 205, 0, 1);
      data[i] = 9 + normalized * 61;
      data[i + 1] = 8 + normalized * 57;
      data[i + 2] = 13 + normalized * 63;
    }
  } else {
    // dark-obsidian: 高对比乌木暗谱：底纸深炭黑，五线谱与符头为明亮乳白
    for (let i = 0; i < data.length; i += 4) {
      const lum = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
      const inv = clamp((252 - lum) / 200, 0, 1);
      data[i] = Math.round(22 + inv * 220);
      data[i + 1] = Math.round(21 + inv * 216);
      data[i + 2] = Math.round(26 + inv * 210);
    }
  }
  ctx.putImageData(pixels, 0, 0);
}

function makeGlow() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,.64)');
  gradient.addColorStop(.22, 'rgba(255,255,255,.24)');
  gradient.addColorStop(.65, 'rgba(255,255,255,.04)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function makeStarSparkle() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const cx = 64;
  const cy = 64;

  // 柔和光晕底衬
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 54);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  glow.addColorStop(0.2, 'rgba(255, 245, 220, 0.45)');
  glow.addColorStop(0.55, 'rgba(255, 230, 180, 0.12)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);

  // 四角菱形星芒 (4-pointed diamond star)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx, 8);
  ctx.quadraticCurveTo(cx, cy, cx + 8, cy);
  ctx.quadraticCurveTo(cx, cy, cx, 120);
  ctx.quadraticCurveTo(cx, cy, cx - 8, cy);
  ctx.quadraticCurveTo(cx, cy, cx, 8);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(8, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy + 8);
  ctx.quadraticCurveTo(cx, cy, 120, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy - 8);
  ctx.quadraticCurveTo(cx, cy, 8, cy);
  ctx.fill();

  // 核心微光圆
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

function makeMusicNote() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const cx = 64;
  const cy = 64;

  // 柔和微芒环绕
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 52);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
  glow.addColorStop(0.4, 'rgba(255, 240, 200, 0.25)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);

  // 音乐音符符头与符干 ♪
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 74px "Segoe UI Symbol", "Apple Symbols", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('♪', cx, cy + 4);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

function makeFireflyGlow() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 56);
  gradient.addColorStop(0, 'rgba(255,220,180,1)');
  gradient.addColorStop(0.2, 'rgba(255,180,100,0.6)');
  gradient.addColorStop(0.5, 'rgba(200,100,30,0.2)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function makeBubble() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 40, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.8, 'rgba(180,220,255,0.4)');
  gradient.addColorStop(0.95, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.stroke();
  return new THREE.CanvasTexture(canvas);
}

function makeInkDrop() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
  gradient.addColorStop(0, 'rgba(0,0,0,0.8)');
  gradient.addColorStop(0.4, 'rgba(0,0,0,0.5)');
  gradient.addColorStop(0.7, 'rgba(0,0,0,0.2)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}


export function ScoreStage({project, timeRef, settings, onCanvasReady}: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const holder = mount.current;
    if (!holder) return;
    const scoreTheme: ScoreTheme = settings.scoreTheme || 'classic-ivory';
    const stageBg = scoreTheme === 'classic-ivory' ? '#0e0f12'
      : scoreTheme === 'neon-inverted' ? '#050508'
      : scoreTheme === 'original-vintage' ? '#433f4a'
      : '#111014';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(stageBg);
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 500);
    const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = scoreTheme === 'classic-ivory' ? 1.05
      : scoreTheme === 'neon-inverted' ? 1.15
      : scoreTheme === 'original-vintage' ? 0.85
      : 1.0;
    holder.appendChild(renderer.domElement);
    onCanvasReady?.(renderer.domElement);

    const ambient = new THREE.AmbientLight(
      scoreTheme === 'classic-ivory' ? '#f5f0eb' : scoreTheme === 'original-vintage' ? '#ddd3e3' : '#d2d0dc',
      scoreTheme === 'classic-ivory' ? 1.05 : scoreTheme === 'original-vintage' ? 0.8 : 0.85
    );
    scene.add(ambient);
    const light = new THREE.DirectionalLight('#ffffff', scoreTheme === 'classic-ivory' ? 0.9 : 0.7);
    light.position.set(-4, 14, -5);
    scene.add(light);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({color: stageBg, toneMapped: false}));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -.025;
    scene.add(ground);

    const score = new THREE.Mesh(new THREE.PlaneGeometry(project.width * SCORE_SCALE, project.height * SCORE_SCALE), new THREE.MeshBasicMaterial({color: '#ffffff', side: THREE.DoubleSide, toneMapped: false}));
    score.rotation.x = -Math.PI / 2;
    score.position.set(project.width * SCORE_SCALE / 2, 0, project.height * SCORE_SCALE / 2);
    scene.add(score);
    let texture: THREE.CanvasTexture | undefined;
    const image = new Image();
    const source = URL.createObjectURL(new Blob([project.svg], {type: 'image/svg+xml'}));
    image.onload = () => {
      const paper = document.createElement('canvas');
      const ratio = Math.min(2, 4096 / Math.max(project.width, project.height));
      paper.width = Math.max(1, Math.round(project.width * ratio));
      paper.height = Math.max(1, Math.round(project.height * ratio));
      const ctx = paper.getContext('2d')!;
      ctx.fillStyle = scoreTheme === 'classic-ivory' ? '#faf8f2'
        : scoreTheme === 'neon-inverted' ? '#0a0a0e'
        : scoreTheme === 'original-vintage' ? '#d9d4cb'
        : '#1a191d';
      ctx.fillRect(0, 0, paper.width, paper.height);
      ctx.drawImage(image, 0, 0, paper.width, paper.height);
      gradePaper(ctx, paper.width, paper.height, scoreTheme);
      texture = new THREE.CanvasTexture(paper);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      (score.material as THREE.MeshBasicMaterial).map = texture;
      (score.material as THREE.MeshBasicMaterial).needsUpdate = true;
      URL.revokeObjectURL(source);
    };
    image.onerror = () => URL.revokeObjectURL(source);
    image.src = source;
    const glow = makeGlow();
    const starTexture = makeStarSparkle();
    const noteTexture = makeMusicNote();
    const fireflyTexture = makeFireflyGlow();
    const bubbleTexture = makeBubble();
    const inkTexture = makeInkDrop();

    // FX 粒子缓冲 (Special FX)
    const MAX_FX = 200;
    const fxGeo = new THREE.BufferGeometry();
    const fxPos = new Float32Array(MAX_FX * 3);
    const fxCol = new Float32Array(MAX_FX * 3);
    const fxSizeArray = new Float32Array(MAX_FX);
    for (let p = 0; p < MAX_FX; p++) {
      fxPos[p * 3 + 1] = -100;
      fxSizeArray[p] = 1.0;
    }
    fxGeo.setAttribute('position', new THREE.BufferAttribute(fxPos, 3));
    fxGeo.setAttribute('color', new THREE.BufferAttribute(fxCol, 3));
    fxGeo.setAttribute('size', new THREE.BufferAttribute(fxSizeArray, 1));

    const fxMat = new THREE.PointsMaterial({
      size: 0.3,
      map: starTexture,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    // @ts-ignore
    fxMat.onBeforeCompile = (shader: any) => {
      shader.vertexShader = shader.vertexShader.replace(
        'uniform float size;',
        'uniform float size;\nattribute float size;'
      ).replace(
        'gl_PointSize = size * ( scale / - mvPosition.z );',
        'gl_PointSize = size * attribute size * ( scale / - mvPosition.z );'
      );
    };
    const fxPoints = new THREE.Points(fxGeo, fxMat);
    scene.add(fxPoints);

    type FxParticle = {
      active: boolean;
      x: number; y: number; z: number;
      vx: number; vy: number; vz: number;
      life: number; maxLife: number;
      r: number; g: number; b: number;
      drag: number; gravity: number;
      size: number; spin: number;
    };
    const fxParticles: FxParticle[] = Array.from({length: MAX_FX}, () => ({
      active: false,
      x: 0, y: -100, z: 0,
      vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 1,
      r: 1, g: 1, b: 1,
      drag: 0.94, gravity: -0.15,
      size: 1.0, spin: 0
    }));
    let fxHead = 0;
    const emitFx = (
      x: number, y: number, z: number,
      vx: number, vy: number, vz: number,
      r: number, g: number, b: number,
      duration = 1.0,
      drag = 0.94,
      gravity = -0.15,
      size = 1.0
    ) => {
      const p = fxParticles[fxHead];
      p.active = true;
      p.x = x; p.y = y; p.z = z;
      p.vx = vx; p.vy = vy; p.vz = vz;
      p.life = 0; p.maxLife = duration;
      p.r = r; p.g = g; p.b = b;
      p.drag = drag; p.gravity = gravity;
      p.size = size;
      p.spin = (Math.random() - 0.5) * 10;
      fxHead = (fxHead + 1) % MAX_FX;
    };

    // 碎星粒子缓冲 (Sparkles & Stardust)
    const MAX_SPARKLES = 360;
    const sparkleGeo = new THREE.BufferGeometry();
    const sparklePos = new Float32Array(MAX_SPARKLES * 3);
    const sparkleCol = new Float32Array(MAX_SPARKLES * 3);
    for (let p = 0; p < MAX_SPARKLES; p++) {
      sparklePos[p * 3 + 1] = -100;
    }
    sparkleGeo.setAttribute('position', new THREE.BufferAttribute(sparklePos, 3));
    sparkleGeo.setAttribute('color', new THREE.BufferAttribute(sparkleCol, 3));

    const sparkleMat = new THREE.PointsMaterial({
      size: 0.22,
      map: starTexture,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const sparklePoints = new THREE.Points(sparkleGeo, sparkleMat);
    scene.add(sparklePoints);

    type Sparkle = {
      active: boolean;
      x: number; y: number; z: number;
      vx: number; vy: number; vz: number;
      life: number; maxLife: number;
      r: number; g: number; b: number;
      drag: number; gravity: number;
    };
    const sparkles: Sparkle[] = Array.from({length: MAX_SPARKLES}, () => ({
      active: false,
      x: 0, y: -100, z: 0,
      vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 1,
      r: 1, g: 1, b: 1,
      drag: 0.94, gravity: -0.15,
    }));
    let sparkleHead = 0;
    const emitSparkle = (
      x: number, y: number, z: number,
      vx: number, vy: number, vz: number,
      r: number, g: number, b: number,
      duration = 0.65,
      drag = 0.94,
      gravity = -0.15
    ) => {
      const sp = sparkles[sparkleHead];
      sp.active = true;
      sp.x = x; sp.y = y; sp.z = z;
      sp.vx = vx; sp.vy = vy; sp.vz = vz;
      sp.life = 0; sp.maxLife = duration;
      sp.r = r; sp.g = g; sp.b = b;
      sp.drag = drag; sp.gravity = gravity;
      sparkleHead = (sparkleHead + 1) % MAX_SPARKLES;
    };

    // 乐符微尘缓冲 (Musical Notes)
    const MAX_NOTES = 48;
    const noteGeo = new THREE.BufferGeometry();
    const notePos = new Float32Array(MAX_NOTES * 3);
    const noteCol = new Float32Array(MAX_NOTES * 3);
    for (let p = 0; p < MAX_NOTES; p++) {
      notePos[p * 3 + 1] = -100;
    }
    noteGeo.setAttribute('position', new THREE.BufferAttribute(notePos, 3));
    noteGeo.setAttribute('color', new THREE.BufferAttribute(noteCol, 3));

    const noteMat = new THREE.PointsMaterial({
      size: 0.32,
      map: noteTexture,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const notePoints = new THREE.Points(noteGeo, noteMat);
    scene.add(notePoints);

    type NoteP = {
      active: boolean;
      x: number; y: number; z: number;
      vx: number; vy: number; vz: number;
      life: number; maxLife: number;
      r: number; g: number; b: number;
      seed: number;
    };
    const noteParticles: NoteP[] = Array.from({length: MAX_NOTES}, () => ({
      active: false,
      x: 0, y: -100, z: 0,
      vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 1.3,
      r: 1, g: 1, b: 1,
      seed: 0,
    }));
    let noteHead = 0;
    const emitNote = (
      x: number, y: number, z: number,
      r: number, g: number, b: number,
      duration = 1.3
    ) => {
      const np = noteParticles[noteHead];
      np.active = true;
      np.x = x; np.y = y; np.z = z;
      np.vx = (Math.random() - 0.5) * 0.12;
      np.vy = 0.3 + Math.random() * 0.22;
      np.vz = (Math.random() - 0.5) * 0.12;
      np.life = 0; np.maxLife = duration;
      np.r = r; np.g = g; np.b = b;
      np.seed = Math.random() * 10;
      noteHead = (noteHead + 1) % MAX_NOTES;
    };

    const keys = cameraKeys(project.events);
    const performers = [1, 2].map(staff => {
      const core = new THREE.Mesh(new THREE.SphereGeometry(.083, 24, 16), new THREE.MeshBasicMaterial({color: '#ffffff', toneMapped: false, transparent: true}));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({map: glow, color: '#ffffff', transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false}));
      halo.scale.set(.48, .48, 1);
      core.add(halo);
      scene.add(core);
      const wash = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 5), new THREE.MeshBasicMaterial({map: glow, transparent: true, opacity: .15, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false}));
      wash.rotation.x = -Math.PI / 2;
      scene.add(wash);
      const trail = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({color: '#ffffff', transparent: true, opacity: 0, toneMapped: false, depthWrite: false}));
      const trailHalo = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false}));
      const trailFork1 = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false}));
      const trailFork2 = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false}));
      
      const orbitGeo = new THREE.BufferGeometry();
      const orbitPos = new Float32Array(6 * 3);
      orbitGeo.setAttribute('position', new THREE.BufferAttribute(orbitPos, 3));
      const orbitPoints = new THREE.Points(orbitGeo, new THREE.PointsMaterial({
        size: 0.18, map: starTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      
      scene.add(trail, trailHalo, trailFork1, trailFork2, orbitPoints);
      return {
        core, halo, wash, trail, trailHalo, trailFork1, trailFork2, orbitGeo, orbitPoints,
        landings: groupLandings(project.events, staff as 1 | 2), trailPair: ''
      };
    });
    const rings = Array.from({length: 120}, () => {
      const material = new THREE.MeshBasicMaterial({color: '#ffffff', side: THREE.DoubleSide, transparent: true, opacity: 0, toneMapped: false, depthWrite: false});
      const mesh = new THREE.Mesh(new THREE.RingGeometry(.15, .17, 48), material);
      mesh.rotation.x = -Math.PI / 2;
      scene.add(mesh);
      return mesh;
    });
    let request = 0;
    let previous = 0;
    let previousTime = -1;
    const colors = [new THREE.Color(), new THREE.Color()];
    const highlight = new THREE.Color('#fff6e8');
    const white = new THREE.Color('#ffffff');
    let cx = keys[0].x * SCORE_SCALE;
    let cz = keys[0].y * SCORE_SCALE;
    const resize = () => {
      const width = holder.clientWidth;
      const height = holder.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(holder);
    resize();
    let lastFxEffect = '';
    const draw = (now: number) => {
      request = requestAnimationFrame(draw);
      const delta = clamp((now - previous) / 1000, 0, .1);
      previous = now;
      const t = timeRef.current || 0;
      const s = settingsRef.current;
      const jumpStyle = s.jumpStyle || 'elastic';
      const jumpHeight = s.jumpHeight || 1.0;
      const bounciness = s.bounciness !== undefined ? s.bounciness : 1.0;
      const cameraTurn = s.cameraTurn || 'wide-arc';
      const effect = s.particleEffect || 'all';
      if (effect !== lastFxEffect) {
        lastFxEffect = effect;
        fxMat.map = effect === 'firefly' ? fireflyTexture
                  : effect === 'inkwash' ? inkTexture
                  : effect === 'bubbles' ? bubbleTexture
                  : starTexture;
      }
      const density = s.particleDensity !== undefined ? s.particleDensity : 1.0;
      const ribbonScale = (s.ribbonWidth !== undefined ? s.ribbonWidth : 1.2) * (effect === 'minimal' ? 0.6 : effect === 'ribbon' ? 1.35 : 1.0);

      colors[0].set(s.violet);
      colors[1].set(s.amber);
      performers.forEach((performer, i) => {
        const {core, halo, wash, trail, trailHalo, trailFork1, trailFork2, orbitGeo, orbitPoints, landings} = performer;
        if (!landings.length) { core.visible = wash.visible = trail.visible = trailHalo.visible = trailFork1.visible = trailFork2.visible = orbitPoints.visible = false; return; }
        const state = performanceAt(landings, t, jumpStyle, jumpHeight, bounciness, cameraTurn);
        
        let pitchCol = colors[i].clone();
        if (s.pitchColor && state.to) {
          const pitch = state.to.pitch || 60;
          if (pitch < 48) pitchCol.lerp(new THREE.Color(1.0, 0.4, 0.2), 0.35);
          else if (pitch > 72) pitchCol.lerp(new THREE.Color(0.4, 0.5, 1.0), 0.35);
        }
        
        core.visible = wash.visible = state.opacity > .02;
        core.position.set(...state.position);

        core.scale.set(
          (1 + state.pulse * .08) * state.squashX,
          (1 - state.pulse * .12) * state.squashY,
          (1 + state.pulse * .08) * state.squashX
        );

        const coreMat = core.material as THREE.MeshBasicMaterial;
        coreMat.color.copy(pitchCol).lerp(white, .55).multiplyScalar(1.6 + s.glow * .8);
        coreMat.opacity = state.opacity;
        (halo.material as THREE.SpriteMaterial).color.copy(pitchCol);
        (halo.material as THREE.SpriteMaterial).opacity = state.opacity * (.12 + s.glow * .18);
        wash.position.set(state.position[0], .015, state.position[2]);
        (wash.material as THREE.MeshBasicMaterial).color.copy(pitchCol);
        (wash.material as THREE.MeshBasicMaterial).opacity = state.opacity * (.075 + s.glow * .13);
        const fraction = state.departing ? state.u : 1;
        const showTrail = state.trailOpacity > 0 && fraction > .01 && state.pathFrom.scoreId !== state.to.scoreId;
        trail.visible = trailHalo.visible = showTrail;
        trailFork1.visible = trailFork2.visible = showTrail && !!s.trailFork;
        
        if (showTrail) {
          const pair = `${state.pathFrom.scoreId}>${state.to.scoreId}:${jumpStyle}:${jumpHeight}:${cameraTurn}:${ribbonScale.toFixed(2)}`;
          if (performer.trailPair !== pair) {
            const points = Array.from({length: 28}, (_, step) =>
              new THREE.Vector3(...arcPoint(state.pathFrom, state.to, step / 27, jumpStyle, jumpHeight, cameraTurn))
            );
            const path = new THREE.CatmullRomCurve3(points);
            trail.geometry.dispose(); trailHalo.geometry.dispose();
            trailFork1.geometry.dispose(); trailFork2.geometry.dispose();
            
            trail.geometry = new THREE.TubeGeometry(path, 32, .008 * ribbonScale, 6, false);
            trailHalo.geometry = new THREE.TubeGeometry(path, 32, .032 * ribbonScale, 6, false);
            const forkGeom = new THREE.TubeGeometry(path, 32, .008 * ribbonScale * 0.6, 6, false);
            trailFork1.geometry = forkGeom;
            trailFork2.geometry = forkGeom.clone();
            performer.trailPair = pair;
          }
          const visibleSegments = Math.max(1, Math.ceil(fraction * 32));
          trail.geometry.setDrawRange(0, visibleSegments * 6 * 6);
          trailHalo.geometry.setDrawRange(0, visibleSegments * 6 * 6);
          trailFork1.geometry.setDrawRange(0, visibleSegments * 6 * 6);
          trailFork2.geometry.setDrawRange(0, visibleSegments * 6 * 6);
          
          const ribbonBonus = effect === 'ribbon' ? 1.35 : 1.0;
          (trail.material as THREE.MeshBasicMaterial).color.copy(pitchCol).lerp(highlight, .25).multiplyScalar(1.45 * ribbonBonus);
          (trail.material as THREE.MeshBasicMaterial).opacity = state.trailOpacity * state.opacity;
          (trailHalo.material as THREE.MeshBasicMaterial).color.copy(pitchCol);
          (trailHalo.material as THREE.MeshBasicMaterial).opacity = state.trailOpacity * state.opacity * (.05 + s.glow * .08) * ribbonBonus;
          
          if (s.trailFork) {
            trailFork1.position.z = 0.015;
            trailFork2.position.z = -0.015;
            const forkCol = pitchCol.clone().offsetHSL(0.05, 0, 0);
            (trailFork1.material as THREE.MeshBasicMaterial).color.copy(forkCol);
            (trailFork2.material as THREE.MeshBasicMaterial).color.copy(forkCol);
            (trailFork1.material as THREE.MeshBasicMaterial).opacity = state.trailOpacity * state.opacity * 0.5;
            (trailFork2.material as THREE.MeshBasicMaterial).opacity = state.trailOpacity * state.opacity * 0.5;
          }
        }
        
        if (!state.departing && s.idleOrbit && state.landed && state.opacity > 0.05) {
          orbitPoints.visible = true;
          const posAttr = orbitGeo.attributes.position;
          for(let k=0; k<6; k++) {
            const angle = t * 1.5 + (k / 6) * Math.PI * 2;
            posAttr.setXYZ(k, state.position[0] + Math.cos(angle)*0.06, state.position[1], state.position[2] + Math.sin(angle)*0.06);
          }
          posAttr.needsUpdate = true;
          (orbitPoints.material as THREE.PointsMaterial).color.copy(pitchCol);
          (orbitPoints.material as THREE.PointsMaterial).opacity = state.opacity;
        } else {
          orbitPoints.visible = false;
        }

        const velScale = s.velocityResponse && state.to.velocity ? state.to.velocity / 90 : 1;
        if (state.departing && effect !== 'minimal' && density > 0.05) {
          if (effect !== 'notes') {
            const emitRate = 0.55 * density * velScale * (state.position[1] > 0.22 ? 1.6 : 1.0);
            if (Math.random() < emitRate) {
              const col = pitchCol;
              emitSparkle(
                state.position[0] + (Math.random() - 0.5) * 0.04,
                state.position[1] + (Math.random() - 0.5) * 0.04,
                state.position[2] + (Math.random() - 0.5) * 0.04,
                (Math.random() - 0.5) * 0.06,
                (Math.random() - 0.3) * 0.05,
                (Math.random() - 0.5) * 0.06,
                col.r * 0.7 + 0.3,
                col.g * 0.7 + 0.3,
                col.b * 0.7 + 0.3,
                0.6 + Math.random() * 0.3,
                0.93,
                -0.12
              );
            }
          }
          if ((effect === 'all' || effect === 'notes') && state.position[1] > 0.28) {
            if (Math.random() < 0.08 * density * velScale) {
              const col = pitchCol;
              emitNote(
                state.position[0] + (Math.random() - 0.5) * 0.08,
                state.position[1] + 0.04,
                state.position[2] + (Math.random() - 0.5) * 0.08,
                col.r * 0.8 + 0.2,
                col.g * 0.8 + 0.2,
                col.b * 0.8 + 0.2,
                1.2 + Math.random() * 0.4
              );
            }
          }
          
          if (effect === 'aurora') {
            const emitRate = 0.7 * density * velScale;
            if (Math.random() < emitRate) {
              const hue = ((now/1000) * 40 + state.u * 120) % 360;
              const col = new THREE.Color().setHSL(hue / 360, 0.85, 0.7);
              emitFx(state.position[0], state.position[1], state.position[2],
                (Math.random()-0.5)*0.05, (Math.random()-0.5)*0.05, (Math.random()-0.5)*0.05,
                col.r, col.g, col.b, 1.2, 0.97, -0.03, 1.0);
            }
          } else if (effect === 'firefly') {
            const emitRate = 0.4 * density * velScale;
            if (Math.random() < emitRate) {
              emitFx(state.position[0], state.position[1], state.position[2],
                (Math.random()-0.5)*0.05, (Math.random()-0.5)*0.05, (Math.random()-0.5)*0.05,
                1.0, 0.8, 0.4, 1.8, 0.98, -0.02, 0.14);
            }
          } else if (effect === 'lightning') {
            if (Math.random() < 0.25 * density * velScale) {
              for (let k=0; k<2; k++) {
                emitFx(state.position[0] + (Math.random()-0.5)*0.1, state.position[1] + (Math.random()-0.5)*0.1, state.position[2] + (Math.random()-0.5)*0.1,
                  (Math.random()-0.5)*0.8, (Math.random()-0.5)*0.8, (Math.random()-0.5)*0.8,
                  0.8, 0.9, 1.0, 0.15, 1.0, 0, 0.8);
              }
            }
          } else if (effect === 'bubbles') {
            if (Math.random() < 0.3 * density * velScale) {
              emitFx(state.position[0] + (Math.random()-0.5)*0.05, state.position[1] + (Math.random()-0.5)*0.05, state.position[2] + (Math.random()-0.5)*0.05,
                (Math.random()-0.5)*0.08, 0.1, (Math.random()-0.5)*0.08,
                1, 1, 1, 2.5, 0.96, 0.08, 0.1 + Math.random()*0.25);
            }
          }
        }
      });

      const isForward = t >= previousTime && (t - previousTime) < 0.28;
      let ringIndex = 0;
      const seen = new Set<string>();
      for (let index = project.events.length - 1; index >= 0; index--) {
        const event = project.events[index];
        const age = t - event.time;
        if (age > 4) break;
        if (age < 0 || seen.has(event.scoreId)) continue;
        if (ringIndex >= rings.length) break;
        seen.add(event.scoreId);

        let pitchCol = colors[event.staff - 1].clone();
        if (s.pitchColor && event.pitch) {
          if (event.pitch < 48) pitchCol.lerp(new THREE.Color(1.0, 0.4, 0.2), 0.35);
          else if (event.pitch > 72) pitchCol.lerp(new THREE.Color(0.4, 0.5, 1.0), 0.35);
        }

        const isFresh = isForward && previousTime >= 0 && event.time > previousTime && event.time <= t;
        const velScale = s.velocityResponse && event.velocity ? event.velocity / 90 : 1;

        if (isFresh && effect !== 'minimal' && density > 0.05) {
          const bx = event.x * SCORE_SCALE;
          const bz = event.y * SCORE_SCALE;
          const handCol = pitchCol;

          if (effect !== 'notes') {
            const burstCount = Math.round((7 + Math.random() * 5) * Math.min(1.8, density) * velScale);
            for (let b = 0; b < burstCount; b++) {
              const angle = (b / burstCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
              const spd = 0.25 + Math.random() * 0.5;
              emitSparkle(
                bx, 0.05, bz,
                Math.cos(angle) * spd,
                0.28 + Math.random() * 0.38,
                Math.sin(angle) * spd,
                handCol.r * 0.65 + 0.35,
                handCol.g * 0.65 + 0.35,
                handCol.b * 0.65 + 0.35,
                0.65 + Math.random() * 0.35,
                0.9,
                -0.45
              );
            }
          }

          if ((effect === 'all' || effect === 'notes') && Math.random() < 0.4 * density * velScale) {
            emitNote(
              bx, 0.08, bz,
              handCol.r * 0.8 + 0.2,
              handCol.g * 0.8 + 0.2,
              handCol.b * 0.8 + 0.2,
              1.4
            );
          }
          
          if (effect === 'fireworks') {
            const fwCount = Math.round((15 + Math.random() * 5) * density * velScale);
            for (let b = 0; b < fwCount; b++) {
              const angle = (b / fwCount) * Math.PI * 2 + (Math.random() - 0.5);
              const spd = 0.1 + Math.random() * 0.2;
              const c = handCol.clone().offsetHSL((Math.random()-0.5)*0.16, 0, 0);
              emitFx(bx, 0.05, bz,
                Math.cos(angle) * spd, 1.0 + Math.random() * 1.0, Math.sin(angle) * spd,
                c.r, c.g, c.b, 0.8, 0.92, -1.2, 1.0);
            }
          } else if (effect === 'firefly') {
            const ffCount = Math.round((3 + Math.random() * 2) * density * velScale);
            for (let b = 0; b < ffCount; b++) {
              emitFx(bx + (Math.random()-0.5)*0.1, 0.05, bz + (Math.random()-0.5)*0.1,
                (Math.random()-0.5)*0.1, 0.05 + Math.random()*0.05, (Math.random()-0.5)*0.1,
                1.0, 0.8, 0.4, 1.8, 0.98, -0.02, 0.14);
            }
          } else if (effect === 'inkwash') {
            const inkCount = Math.round((8 + Math.random() * 4) * density * velScale);
            for (let b = 0; b < inkCount; b++) {
              const angle = (b / inkCount) * Math.PI * 2 + (Math.random() - 0.5);
              const spd = 0.2 + Math.random() * 0.3;
              const rc = 0.15 + Math.random() * 0.15;
              emitFx(bx, 0.02, bz,
                Math.cos(angle) * spd, 0, Math.sin(angle) * spd,
                rc, rc, rc, 2.0, 0.85, 0, 1.5 + Math.random()*1.0);
            }
          } else if (effect === 'lightning') {
            const lnCount = Math.round(8 * density * velScale);
            for (let b = 0; b < lnCount; b++) {
              const angle = (b / lnCount) * Math.PI * 2;
              const spd = 1.5 + Math.random() * 1.0;
              emitFx(bx, 0.05, bz,
                Math.cos(angle) * spd, 0.1, Math.sin(angle) * spd,
                0.8, 0.9, 1.0, 0.15, 1.0, 0, 0.8);
            }
          } else if (effect === 'bubbles') {
            const bCount = Math.round((2 + Math.random() * 2) * density * velScale);
            for (let b = 0; b < bCount; b++) {
              emitFx(bx + (Math.random()-0.5)*0.1, 0.05, bz + (Math.random()-0.5)*0.1,
                (Math.random()-0.5)*0.1, 0.1 + Math.random()*0.1, (Math.random()-0.5)*0.1,
                1, 1, 1, 2.5, 0.96, 0.08, 0.1 + Math.random()*0.25);
            }
          }
        }

        for (let r = 0; r < (s.landingRipple ? 3 : 1); r++) {
          if (ringIndex >= rings.length) break;
          const ring = rings[ringIndex++];
          ring.visible = true;
          ring.position.set(event.x * SCORE_SCALE, .035, event.y * SCORE_SCALE);
          
          const rAge = age - r * 0.08;
          if (rAge < 0) {
            ring.visible = false;
            continue;
          }
          
          const pulse = Math.exp(-rAge / .18);
          const rScale = s.landingRipple ? 1 + .4 * (1 - Math.exp(-rAge / (.07 + r*.02))) : 1 + .28 * (1 - Math.exp(-rAge / .07));
          ring.scale.setScalar(rScale);
          (ring.material as THREE.MeshBasicMaterial).color.copy(pitchCol).multiplyScalar(1.15 + s.glow * pulse * 1.3);
          (ring.material as THREE.MeshBasicMaterial).opacity = Math.pow(Math.max(0, 1 - rAge / (4 - r*0.5)), 1.1) * (.68 + .28 * pulse) * (1 - r*0.2);
        }
      }
      for (; ringIndex < rings.length; ringIndex++) rings[ringIndex].visible = false;

      // 拖拽快进/回退时重置游离粒子
      if (Math.abs(t - previousTime) > 0.35) {
        for (let p = 0; p < MAX_SPARKLES; p++) sparkles[p].active = false;
        for (let p = 0; p < MAX_NOTES; p++) noteParticles[p].active = false;
        for (let p = 0; p < MAX_FX; p++) fxParticles[p].active = false;
      }

      let activeSparkles = false;
      for (let p = 0; p < MAX_SPARKLES; p++) {
        const sp = sparkles[p];
        if (!sp.active) {
          sparklePos[p * 3 + 1] = -100;
          sparkleCol[p * 3] = sparkleCol[p * 3 + 1] = sparkleCol[p * 3 + 2] = 0;
          continue;
        }
        sp.life += delta;
        if (sp.life >= sp.maxLife) {
          sp.active = false;
          sparklePos[p * 3 + 1] = -100;
          sparkleCol[p * 3] = sparkleCol[p * 3 + 1] = sparkleCol[p * 3 + 2] = 0;
          continue;
        }
        activeSparkles = true;
        sp.vx *= sp.drag;
        sp.vy = sp.vy * sp.drag + sp.gravity * delta;
        sp.vz *= sp.drag;
        sp.x += sp.vx * delta;
        sp.y = Math.max(0.015, sp.y + sp.vy * delta);
        sp.z += sp.vz * delta;

        const prog = sp.life / sp.maxLife;
        const alpha = Math.sin(prog * Math.PI) * Math.pow(1 - prog, 0.55);
        sparklePos[p * 3] = sp.x;
        sparklePos[p * 3 + 1] = sp.y;
        sparklePos[p * 3 + 2] = sp.z;
        sparkleCol[p * 3] = sp.r * alpha * 1.6;
        sparkleCol[p * 3 + 1] = sp.g * alpha * 1.6;
        sparkleCol[p * 3 + 2] = sp.b * alpha * 1.6;
      }
      sparkleGeo.attributes.position.needsUpdate = true;
      sparkleGeo.attributes.color.needsUpdate = true;
      sparklePoints.visible = activeSparkles && effect !== 'minimal' && effect !== 'notes';

      let activeNotes = false;
      for (let p = 0; p < MAX_NOTES; p++) {
        const np = noteParticles[p];
        if (!np.active) {
          notePos[p * 3 + 1] = -100;
          noteCol[p * 3] = noteCol[p * 3 + 1] = noteCol[p * 3 + 2] = 0;
          continue;
        }
        np.life += delta;
        if (np.life >= np.maxLife) {
          np.active = false;
          notePos[p * 3 + 1] = -100;
          noteCol[p * 3] = noteCol[p * 3 + 1] = noteCol[p * 3 + 2] = 0;
          continue;
        }
        activeNotes = true;
        const prog = np.life / np.maxLife;
        np.y += np.vy * delta;
        const sway = Math.sin(t * 4.2 + np.seed) * 0.07 * delta;
        np.x += np.vx * delta + sway;
        np.z += np.vz * delta;

        const alpha = Math.sin(prog * Math.PI) * (1 - prog * 0.4);
        notePos[p * 3] = np.x;
        notePos[p * 3 + 1] = np.y;
        notePos[p * 3 + 2] = np.z;
        noteCol[p * 3] = np.r * alpha * 1.4;
        noteCol[p * 3 + 1] = np.g * alpha * 1.4;
        noteCol[p * 3 + 2] = np.b * alpha * 1.4;
      }
      noteGeo.attributes.position.needsUpdate = true;
      noteGeo.attributes.color.needsUpdate = true;
      notePoints.visible = activeNotes && (effect === 'all' || effect === 'notes');

      let activeFx = false;
      for (let p = 0; p < MAX_FX; p++) {
        const fp = fxParticles[p];
        if (!fp.active) {
          fxPos[p * 3 + 1] = -100;
          fxCol[p * 3] = fxCol[p * 3+1] = fxCol[p * 3+2] = 0;
          continue;
        }
        fp.life += delta;
        if (fp.life >= fp.maxLife) {
          fp.active = false;
          fxPos[p * 3 + 1] = -100;
          continue;
        }
        activeFx = true;
        fp.vx *= fp.drag;
        fp.vy = fp.vy * fp.drag + fp.gravity * delta;
        fp.vz *= fp.drag;
        fp.x += fp.vx * delta;
        fp.y = Math.max(0.015, fp.y + fp.vy * delta);
        fp.z += fp.vz * delta;

        const prog = fp.life / fp.maxLife;
        let alpha = 1.0;
        
        if (effect === 'bubbles') {
          alpha = prog < 0.1 ? prog / 0.1 : 1.0; 
          fp.x += Math.sin(t * 3 + fp.spin) * 0.02 * delta;
        } else if (effect === 'firefly') {
          alpha = Math.sin(prog * Math.PI) * (0.6 + Math.sin(t * 10 + fp.spin) * 0.4);
        } else if (effect === 'inkwash') {
          alpha = (1 - prog) * 0.6;
          fp.size += delta * 1.5;
        } else {
          alpha = Math.sin(prog * Math.PI) * Math.pow(1 - prog, 0.5);
        }

        fxPos[p * 3] = fp.x;
        fxPos[p * 3 + 1] = fp.y;
        fxPos[p * 3 + 2] = fp.z;
        fxCol[p * 3] = fp.r * alpha * 1.6;
        fxCol[p * 3 + 1] = fp.g * alpha * 1.6;
        fxCol[p * 3 + 2] = fp.b * alpha * 1.6;
        fxSizeArray[p] = fp.size;
      }
      fxGeo.attributes.position.needsUpdate = true;
      fxGeo.attributes.color.needsUpdate = true;
      fxGeo.attributes.size.needsUpdate = true;
      fxPoints.visible = activeFx;

      const {key: track, isTransition, progress} = cameraAt(keys, t, cameraTurn);
      const targetX = track.x * SCORE_SCALE;
      const targetZ = track.y * SCORE_SCALE;
      const follow = s.follow;
      const baseX = keys[0].x * SCORE_SCALE;
      const baseZ = keys[0].y * SCORE_SCALE;
      const desiredX = THREE.MathUtils.lerp(baseX, targetX, follow);
      const desiredZ = THREE.MathUtils.lerp(baseZ, targetZ, follow);

      // 转弯换行平滑大阻尼，消除猛甩与急停
      const turnDamping = isTransition ? (cameraTurn === 'wide-arc' ? 2.1 : cameraTurn === 'cinematic' ? 1.7 : 2.5) : 3.0;
      const ease = Math.abs(t - previousTime) > .35 ? 1 : 1 - Math.exp(-delta * turnDamping);
      cx = THREE.MathUtils.lerp(cx, desiredX, ease);
      cz = THREE.MathUtils.lerp(cz, desiredZ, ease);
      previousTime = t;

      // 升维广角缓转模式：换行时镜头优雅微拉远 20%，视野开阔平稳入行
      const pullback = (cameraTurn === 'cinematic' && isTransition) ? Math.sin(progress * Math.PI) * 0.22 : 0;
      const distance = s.cameraDistance * (1 + pullback);
      camera.position.set(cx - 3.8 * distance, 7.2 * distance, cz + 9.2 * distance);
      camera.lookAt(cx, 0, cz + .55);
      renderer.render(scene, camera);
    };
    request = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(request);
      observer.disconnect();
      URL.revokeObjectURL(source);
      texture?.dispose();
      glow.dispose();
      starTexture.dispose();
      noteTexture.dispose();
      fireflyTexture.dispose();
      bubbleTexture.dispose();
      inkTexture.dispose();
      sparkleGeo.dispose();
      sparkleMat.dispose();
      noteGeo.dispose();
      noteMat.dispose();
      fxGeo.dispose();
      fxMat.dispose();
      performers.forEach(p => {
        p.orbitGeo.dispose();
      });
      scene.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      onCanvasReady?.(null);
    };
  }, [project, timeRef, settings.scoreTheme]);
  return <div ref={mount} className="score-canvas" aria-label="实时三维曲谱预览" />;
}
