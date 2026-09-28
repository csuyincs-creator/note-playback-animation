import type {Activation, ScoreProject} from './types';

const upper = [76, 79, 83, 79, 76, 74, 76, 79, 81, 84, 81, 79, 76, 79, 83, 86];
const lower = [48, 55, 60, 55, 50, 57, 62, 57];
const staffLines = (y: number) => Array.from({length: 5}, (_, i) => `<path d="M106 ${y + i * 23}H1120" stroke="#514d58" stroke-width="1.5"/>`).join('');
const xFor = (i: number) => 185 + i * 58;
const yFor = (pitch: number, staff: 1 | 2) => (staff === 1 ? 218 : 400) - (pitch - (staff === 1 ? 76 : 48)) * 5.75;
const events: Activation[] = [
  ...upper.map((pitch, i) => ({eventId: `u${i}`, scoreId: `u${i}`, time: i * 0.48, duration: 0.38, pitch, velocity: 78, staff: 1 as const, x: xFor(i), y: yFor(pitch, 1), system: 0, kind: 'attack' as const})),
  ...lower.map((pitch, i) => ({eventId: `l${i}`, scoreId: `l${i}`, time: i * 0.96, duration: 0.7, pitch, velocity: 65, staff: 2 as const, x: xFor(i * 2), y: yFor(pitch, 2), system: 0, kind: 'attack' as const})),
].sort((a, b) => a.time - b.time);
const beamY = (index: number) => Math.min(...events.filter(n => n.staff === 1).slice(Math.floor(index / 4) * 4, Math.floor(index / 4) * 4 + 4).map(n => n.y)) - 53;
const upperBeams = Array.from({length: 4}, (_, group) => `<path d="M${xFor(group * 4) + 10} ${beamY(group * 4)}H${xFor(group * 4 + 3) + 10}" stroke="#272630" stroke-width="9"/>`).join('');
const note = (n: Activation) => {
  const top = n.staff === 1 ? beamY(Number(n.eventId.slice(1))) : n.y - 60;
  return `<g id="${n.scoreId}" class="note"><ellipse cx="${n.x}" cy="${n.y}" rx="11" ry="7" transform="rotate(-20 ${n.x} ${n.y})" fill="#272630"/><path d="M${n.x + 10} ${n.y - 2}V${top}" stroke="#272630" stroke-width="2"/></g>`;
};

export const demo: ScoreProject = {
  title: '一段纸上练习', subtitle: '内置示例 · 用于预览工作台',
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 560" width="1200" height="560"><rect width="1200" height="560" fill="#d9d4cb"/><text x="110" y="77" fill="#45414b" font-size="27" font-family="Georgia,serif">A Study in Motion</text><text x="110" y="106" fill="#77717b" font-size="12" letter-spacing="2" font-family="Arial">SCORE / STUDY 01</text>${staffLines(170)}${staffLines(353)}<text x="113" y="243" font-size="70" fill="#37323e">𝄞</text><text x="116" y="428" font-size="68" fill="#37323e">𝄢</text>${[410, 642, 874].map(x => `<path d="M${x} 170v92M${x} 353v92" stroke="#79727a" stroke-width="1"/>`).join('')}${events.map(note).join('')}${upperBeams}</svg>`,
  width: 1200, height: 560, duration: 8.2, events, midiCount: events.length, unmatched: 0, pageCount: 1, sample: true,
};
