import {useEffect, useRef} from 'react';
import * as THREE from 'three';
import {arcPoint, groupLandings, performanceAt, scorePathPoint, SCORE_SCALE} from './performance';
import type {Activation, ScoreProject, ViewSettings} from './types';

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

function cameraAt(keys: CameraKey[], time: number) {
  if (keys.length === 1 || time <= keys[0].time) return keys[0];
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle].time < time) low = middle + 1;
    else high = middle;
  }
  const i = Math.max(0, low - 1);
  if (i + 1 >= keys.length) return keys.at(-1)!;
  const a = keys[i], b = keys[i + 1];
  const progress = clamp((time - a.time) / (b.time - a.time), 0, 1);
  const [x, y] = scorePathPoint(a, b, progress);
  return {time, x, y, system: b.system};
}

function gradePaper(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const pixels = ctx.getImageData(0, 0, width, height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
    const normalized = clamp((value - 20) / 205, 0, 1);
    data[i] = 9 + normalized * 61;
    data[i + 1] = 8 + normalized * 57;
    data[i + 2] = 13 + normalized * 63;
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

export function ScoreStage({project, timeRef, settings, onCanvasReady}: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const holder = mount.current;
    if (!holder) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#433f4a');
    const camera = new THREE.PerspectiveCamera(42, 1, .1, 500);
    const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .8;
    holder.appendChild(renderer.domElement);
    onCanvasReady?.(renderer.domElement);
    const ambient = new THREE.AmbientLight('#ddd3e3', .8);
    scene.add(ambient);
    const light = new THREE.DirectionalLight('#e4d9d2', .7);
    light.position.set(-4, 12, -5);
    scene.add(light);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({color: '#433f4a', toneMapped: false}));
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
      ctx.fillStyle = '#d9d4cb';
      ctx.fillRect(0, 0, paper.width, paper.height);
      ctx.drawImage(image, 0, 0, paper.width, paper.height);
      gradePaper(ctx, paper.width, paper.height);
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
      scene.add(trail, trailHalo);
      return {core, halo, wash, trail, trailHalo, landings: groupLandings(project.events, staff as 1 | 2), trailPair: ''};
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
    const draw = (now: number) => {
      request = requestAnimationFrame(draw);
      const delta = clamp((now - previous) / 1000, 0, .1);
      previous = now;
      const t = timeRef.current || 0;
      const s = settingsRef.current;
      colors[0].set(s.violet);
      colors[1].set(s.amber);
      performers.forEach((performer, i) => {
        const {core, halo, wash, trail, trailHalo, landings} = performer;
        if (!landings.length) { core.visible = wash.visible = trail.visible = trailHalo.visible = false; return; }
        const state = performanceAt(landings, t);
        core.visible = wash.visible = state.opacity > .02;
        core.position.set(...state.position);
        core.scale.set(1 + state.pulse * .08, 1 - state.pulse * .12, 1 + state.pulse * .08);
        const coreMat = core.material as THREE.MeshBasicMaterial;
        coreMat.color.copy(colors[i]).lerp(white, .55).multiplyScalar(1.6 + s.glow * .8);
        coreMat.opacity = state.opacity;
        (halo.material as THREE.SpriteMaterial).color.copy(colors[i]);
        (halo.material as THREE.SpriteMaterial).opacity = state.opacity * (.12 + s.glow * .18);
        wash.position.set(state.position[0], .015, state.position[2]);
        (wash.material as THREE.MeshBasicMaterial).color.copy(colors[i]);
        (wash.material as THREE.MeshBasicMaterial).opacity = state.opacity * (.075 + s.glow * .13);
        const fraction = state.departing ? state.u : 1;
        const showTrail = state.trailOpacity > 0 && fraction > .01 && state.pathFrom.scoreId !== state.to.scoreId;
        trail.visible = trailHalo.visible = showTrail;
        if (showTrail) {
          const pair = `${state.pathFrom.scoreId}>${state.to.scoreId}`;
          if (performer.trailPair !== pair) {
            const points = Array.from({length: 25}, (_, step) => new THREE.Vector3(...arcPoint(state.pathFrom, state.to, step / 24)));
            const path = new THREE.CatmullRomCurve3(points);
            trail.geometry.dispose();
            trailHalo.geometry.dispose();
            trail.geometry = new THREE.TubeGeometry(path, 32, .008, 5, false);
            trailHalo.geometry = new THREE.TubeGeometry(path, 32, .032, 5, false);
            performer.trailPair = pair;
          }
          const visibleSegments = Math.max(1, Math.ceil(fraction * 32));
          trail.geometry.setDrawRange(0, visibleSegments * 5 * 6);
          trailHalo.geometry.setDrawRange(0, visibleSegments * 5 * 6);
          (trail.material as THREE.MeshBasicMaterial).color.copy(colors[i]).lerp(highlight, .25).multiplyScalar(1.45);
          (trail.material as THREE.MeshBasicMaterial).opacity = state.trailOpacity * state.opacity;
          (trailHalo.material as THREE.MeshBasicMaterial).color.copy(colors[i]);
          (trailHalo.material as THREE.MeshBasicMaterial).opacity = state.trailOpacity * state.opacity * (.05 + s.glow * .08);
        }
      });
      let ringIndex = 0;
      const seen = new Set<string>();
      for (let index = project.events.length - 1; index >= 0; index--) {
        const event = project.events[index];
        const age = t - event.time;
        if (age > 4) break;
        if (age < 0 || seen.has(event.scoreId)) continue;
        if (ringIndex >= rings.length) break;
        seen.add(event.scoreId);
        const ring = rings[ringIndex++];
        ring.visible = true;
        ring.position.set(event.x * SCORE_SCALE, .035, event.y * SCORE_SCALE);
        const pulse = Math.exp(-age / .18);
        ring.scale.setScalar(1 + .28 * (1 - Math.exp(-age / .07)));
        (ring.material as THREE.MeshBasicMaterial).color.copy(colors[event.staff - 1]).multiplyScalar(1.15 + s.glow * pulse * 1.3);
        (ring.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - age / 4, 1.1) * (.68 + .28 * pulse);
      }
      for (; ringIndex < rings.length; ringIndex++) rings[ringIndex].visible = false;
      const track = cameraAt(keys, t);
      const targetX = track.x * SCORE_SCALE;
      const targetZ = track.y * SCORE_SCALE;
      const follow = s.follow;
      const baseX = keys[0].x * SCORE_SCALE;
      const baseZ = keys[0].y * SCORE_SCALE;
      const desiredX = THREE.MathUtils.lerp(baseX, targetX, follow);
      const desiredZ = THREE.MathUtils.lerp(baseZ, targetZ, follow);
      const ease = Math.abs(t - previousTime) > .35 ? 1 : 1 - Math.exp(-delta * 2.7);
      cx = THREE.MathUtils.lerp(cx, desiredX, ease);
      cz = THREE.MathUtils.lerp(cz, desiredZ, ease);
      previousTime = t;
      const distance = s.cameraDistance;
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
  }, [project, timeRef]);
  return <div ref={mount} className="score-canvas" aria-label="实时三维曲谱预览" />;
}
