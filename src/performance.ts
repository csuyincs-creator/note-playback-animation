import type {Activation, CameraTurn, JumpStyle} from './types';

export const SCORE_SCALE = 0.016;
export const INTRO_SECONDS = 0.15;

export function groupLandings(notes: Activation[], staff: 1 | 2) {
  const groups: Activation[][] = [];
  for (const note of notes.filter(n => n.staff === staff).sort((a, b) => a.time - b.time)) {
    const last = groups.at(-1);
    if (last && Math.abs(last[0].time - note.time) < 1e-5) last.push(note);
    else groups.push([note]);
  }
  return groups.map(group =>
    [...group].sort(
      (a, b) =>
        (a.kind === 'attack' ? 0 : 1) - (b.kind === 'attack' ? 0 : 1) ||
        (staff === 1 ? b.pitch - a.pitch : a.pitch - b.pitch)
    )[0]
  );
}

export function arcPoint(
  a: Activation,
  b: Activation,
  u: number,
  style: JumpStyle = 'elastic',
  heightScale = 1,
  cameraTurn: CameraTurn = 'wide-arc'
): [number, number, number] {
  const p = Math.max(0, Math.min(1, u));
  const distance = Math.hypot(b.x - a.x, b.y - a.y) * SCORE_SCALE;
  const interval = Math.max(0, b.time - a.time);

  // 力度动态加权：力度越大，起跳张力略强
  const velocityBonus = 0.85 + (b.velocity / 127) * 0.3;
  let hop =
    (0.27 + Math.min(0.18, distance * 0.05)) *
    Math.min(1.2, Math.max(0.18, interval / 0.22)) *
    heightScale *
    velocityBonus;

  // 根据所选跳跃动力学风格计算轨迹曲线
  let arch = 0;
  if (style === 'fluid') {
    // 优雅流光：更丰满的大抛物线，顶峰平缓，滞空连绵
    arch = Math.sin(p * Math.PI) ** 1.35 * 1.08;
  } else if (style === 'staccato') {
    // 敏捷顿音：快速弹起到高点，然后急速下坠，具有清脆打击感
    arch = p < 0.35 ? (p / 0.35) ** 1.25 : ((1 - p) / 0.65) ** 0.85;
    hop *= 0.9;
  } else if (style === 'comet') {
    // 彗星脉冲：起飞带有抛物突起，顶峰带动态微脉冲
    arch = Math.sin(p * Math.PI) * (1 + 0.2 * Math.sin(p * Math.PI * 2));
    hop *= 1.15;
  } else if (style === 'float') {
    // 浮空漫步：低重力长漂浮，在顶点有更长的慢动作悬浮
    arch = Math.sin(p * Math.PI) ** 0.85 * 1.22;
    hop *= 1.32;
  } else {
    // elastic (Q弹律动): 经典弹性抛物线
    arch = 4 * p * (1 - p);
  }

  const [x, z] = scorePathPoint(a, b, p, cameraTurn);
  return [x * SCORE_SCALE, 0.097 + Math.max(0, arch) * hop, z * SCORE_SCALE];
}

export function scorePathPoint(
  a: Pick<Activation, 'x' | 'y' | 'system'>,
  b: Pick<Activation, 'x' | 'y' | 'system'>,
  u: number,
  cameraTurn: CameraTurn = 'wide-arc'
): [number, number] {
  const p = Math.max(0, Math.min(1, u));
  if (a.system === b.system) return [a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p];

  // 换行/蛇形折返转弯：根据 cameraTurn 计算自适应平滑大圆弧
  const returnsOnRight = b.system % 2 === 1;
  const dy = Math.abs(b.y - a.y);

  // 增大转弯外环半径，告别死硬直角
  const radius =
    cameraTurn === 'wide-arc'
      ? Math.max(160, Math.min(280, dy * 0.9))
      : cameraTurn === 'cinematic'
      ? Math.max(210, Math.min(350, dy * 1.15))
      : Math.max(130, Math.min(220, dy * 0.75));

  const edge = returnsOnRight ? Math.max(a.x, b.x) + radius : Math.min(a.x, b.x) - radius;

  // 优雅贝塞尔控制点平滑入弯
  const cp1x = edge;
  const cp1y = a.y + (b.y - a.y) * 0.18;
  const cp2x = edge;
  const cp2y = b.y - (b.y - a.y) * 0.18;

  const inv = 1 - p;
  const x = inv ** 3 * a.x + 3 * inv ** 2 * p * cp1x + 3 * inv * p ** 2 * cp2x + p ** 3 * b.x;
  const y = inv ** 3 * a.y + 3 * inv ** 2 * p * cp1y + 3 * inv * p ** 2 * cp2y + p ** 3 * b.y;
  return [x, y];
}

export function performanceAt(
  targets: Activation[],
  t: number,
  style: JumpStyle = 'elastic',
  heightScale = 1,
  bounciness = 1,
  cameraTurn: CameraTurn = 'wide-arc'
) {
  let low = 0;
  let high = targets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (targets[middle].time <= t) low = middle + 1;
    else high = middle;
  }
  const i = Math.max(0, low - 1);
  const current = targets[i];
  const next = targets[i + 1];
  const age = t - current.time;
  const landed = age >= 0;
  const restGap = next ? next.time - current.time - current.duration : 0;
  const resting = !!next && restGap > 0.65;
  const interval = next ? Math.max(0.001, next.time - current.time) : 0;
  const travelDuration = next ? (resting ? Math.min(0.62, interval) : interval) : 0;
  const travelStart = next ? next.time - travelDuration : Number.POSITIVE_INFINITY;
  const departing = !!next && landed && t >= travelStart && t < next.time;
  const u = departing ? Math.max(0, Math.min(1, (t - travelStart) / travelDuration)) : 1;
  const from = departing ? current : targets[Math.max(0, i - 1)];
  const to = departing ? next! : current;
  const pathFrom = departing ? current : (i > 0 ? targets[i - 1] : current);

  const position = departing
    ? arcPoint(current, next!, u, style, heightScale, cameraTurn)
    : ([current.x * SCORE_SCALE, 0.097, current.y * SCORE_SCALE] as [number, number, number]);

  // Q弹形变计算 (Squash & Stretch) 与落地二次微回弹 (Secondary Micro-bounce)
  let secondaryBounce = 0;
  let squashX = 1;
  let squashY = 1;

  if (departing) {
    // 飞行中沿起跳方向拉伸，保持体积守恒
    const stretchAmp = style === 'staccato' ? 0.35 : style === 'fluid' ? 0.18 : 0.26;
    const stretch = Math.sin(u * Math.PI) * stretchAmp * bounciness;
    squashY = 1 + stretch;
    squashX = 1 / Math.sqrt(Math.max(0.2, squashY));
  } else if (landed && age < 0.32 && bounciness > 0.05) {
    // 落地后二次弹性微回弹与受力挤压
    const decay = Math.exp(-age * 14);
    const freq = 28;
    const bounceAmp = 0.038 * bounciness;
    secondaryBounce = Math.max(0, Math.sin(age * freq) * bounceAmp * decay);

    // 触地压缩形变
    const impactSquash = Math.sin(Math.min(Math.PI, age * 32)) * decay * 0.28 * bounciness;
    squashY = Math.max(0.62, 1 - impactSquash + secondaryBounce * 3);
    squashX = 1 / Math.sqrt(Math.max(0.2, squashY));
  }

  position[1] += secondaryBounce;

  // 起音前隐藏，首音临近时入场；起音后（休止或演奏中）始终优雅常驻，绝不超时隐去
  const INTRO_SECONDS = 0.25;
  let opacity = 1;
  if (!landed) {
    // 乐曲刚开始或该声部尚未出场前，小球完全不出现；直到首个音符起音前 0.25 秒才平滑显现降落入场
    const introProgress = (t - (current.time - INTRO_SECONDS)) / INTRO_SECONDS;
    opacity = Math.max(0, Math.min(1, introProgress));
    // 入场时从上方平滑落到首个符头上
    position[1] = 0.097 + 0.18 * (1 - opacity * opacity);
  } else if (!departing) {
    // 已经起音之后，停留在符头上，带有舒缓轻微的垂直微浮与柔光呼吸；在休止与长静止期始终优雅待命，绝不消失
    const idleTime = age;
    const breathe = Math.sin(idleTime * 2.8) * 0.012;
    position[1] = 0.097 + Math.max(0, breathe);
    opacity = 1; // 恒定保持存在
  }

  // 拖尾强度适配风格
  const trailBase = style === 'fluid' ? 0.95 : style === 'staccato' ? 0.65 : style === 'comet' ? 0.98 : 0.82;
  const trailOpacity = departing ? trailBase : (i > 0 && landed ? 0.62 * Math.max(0, 1 - age / 0.62) : 0);

  // 待机呼吸柔光脉冲（首音落地前不发光脉冲）
  const breatheGlow = Math.sin(t * 3.2) * 0.5 + 0.5;
  const pulse = (landed && age < 0.6) ? Math.exp(-Math.max(0, age) / 0.1) : (landed ? breatheGlow * 0.28 : 0);

  return {
    position,
    opacity,
    landed,
    pulse,
    from,
    to,
    pathFrom,
    u,
    trailOpacity,
    departing,
    squashX,
    squashY,
    secondaryBounce,
  };
}
