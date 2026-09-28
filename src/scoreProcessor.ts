import {unzipSync, strFromU8} from 'fflate';
import {Midi} from '@tonejs/midi';
import {matchPianoNotes, selectPianoTracks} from './midiMapping';
import type {PianoMidiNote, PianoScoreNote} from './midiMapping';
import type {Activation, ScoreProject} from './types';

type ScoreNote = PianoScoreNote & {duration: number};
type Geometry = {x: number; y: number; system: number};

const childText = (parent: Element, name: string) => parent.querySelector(`:scope > ${name}`)?.textContent?.trim() ?? '';
const parseXml = (text: string) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('MusicXML 格式无效或文件损坏。');
  return doc;
};

async function readScore(file: File) {
  if (!file.name.toLowerCase().endsWith('.mxl')) return await file.text();
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const container = files['META-INF/container.xml'];
  if (!container) throw new Error('MXL 缺少 META-INF/container.xml。');
  const path = parseXml(strFromU8(container)).querySelector('rootfile')?.getAttribute('full-path');
  if (!path || !files[path]) throw new Error('MXL 内找不到 MusicXML 主文件。');
  return strFromU8(files[path]);
}

function identifyNotes(xml: string) {
  const doc = parseXml(xml);
  const parts = [...doc.querySelectorAll('score-partwise > part')];
  if (!parts.length) throw new Error('当前版本支持 partwise MusicXML 曲谱。');
  const partNames = new Map([...doc.querySelectorAll('score-partwise > part-list > score-part')].map(part => {
    const names = [childText(part, 'part-name'), ...[...part.querySelectorAll('score-instrument > instrument-name')].map(node => node.textContent?.trim() || '')];
    return [part.getAttribute('id') || '', names.filter(Boolean).join(' ')] as const;
  }));
  const pianoPart = parts.find(part => /\b(?:grand\s*)?piano\b|\bkeyboard\b/i.test(partNames.get(part.getAttribute('id') || '') || ''));
  if (!pianoPart) throw new Error(`在 ${parts.length} 个 MusicXML 声部中找不到明确标记的钢琴声部。请核对曲谱 part-name/instrument-name。`);
  const notes: ScoreNote[] = [];
  let measureStart = 0;
  let divisions = 1;
  let counter = 0;
  for (const measure of pianoPart.querySelectorAll(':scope > measure')) {
    let cursor = 0;
    let end = 0;
    let previous = 0;
    for (const element of [...measure.children]) {
      if (element.tagName === 'attributes') divisions = Number(childText(element, 'divisions')) || divisions;
      if (element.tagName === 'backup') cursor -= Number(childText(element, 'duration')) / divisions;
      if (element.tagName === 'forward') cursor += Number(childText(element, 'duration')) / divisions;
      if (element.tagName !== 'note') continue;
      const duration = (Number(childText(element, 'duration')) || 0) / divisions;
      const chord = !!element.querySelector(':scope > chord');
      const onset = chord ? previous : cursor;
      const pitchElement = element.querySelector(':scope > pitch');
      const staff = Number(childText(element, 'staff')) === 2 ? 2 : 1;
      const id = `score-note-${++counter}`;
      element.setAttribute('id', id);
      if (pitchElement) {
        const step = childText(pitchElement, 'step');
        const semitone: Record<string, number> = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
        const pitch = (Number(childText(pitchElement, 'octave')) + 1) * 12 + semitone[step] + (Number(childText(pitchElement, 'alter')) || 0);
        if (Number.isFinite(pitch)) notes.push({id, beat: measureStart + onset, pitch, staff, duration});
      }
      if (!chord) { previous = cursor; cursor += duration; }
      end = Math.max(end, cursor);
    }
    measureStart += end;
  }
  if (!notes.length) throw new Error('曲谱里没有可识别的音符。');
  const tempo = Number(doc.querySelector('sound[tempo]')?.getAttribute('tempo')) || 120;
  // Keep the full MIDI file for ensemble audio, but engrave only the grand piano
  // part so camera turns follow rows that the two animated hands actually play.
  for (const part of [...doc.querySelectorAll('score-partwise > part')]) if (part !== pianoPart) part.remove();
  for (const entry of [...doc.querySelectorAll('score-partwise > part-list > score-part')]) {
    if (entry.getAttribute('id') !== pianoPart.getAttribute('id')) entry.remove();
  }
  doc.querySelectorAll('score-partwise > part-list > part-group').forEach(node => node.remove());
  return {xml: new XMLSerializer().serializeToString(doc), notes, tempo, partCount: parts.length,
    pianoPartName: partNames.get(pianoPart.getAttribute('id') || '') || 'Piano'};
}

async function engrave(xml: string) {
  const {default: createModule} = await import('verovio/wasm');
  const {VerovioToolkit} = await import('verovio/esm');
  const toolkit = new VerovioToolkit(await createModule());
  toolkit.resetXmlIdSeed(1);
  toolkit.setOptions({scale: 40, pageWidth: 2800, pageHeight: 3600, breaks: 'auto', adjustPageHeight: true, header: 'none', footer: 'none', svgViewBox: true, spacingStaff: 12});
  if (!toolkit.loadData(xml)) throw new Error('Verovio 无法排版这份 MusicXML。');
  const pages: string[] = [];
  if (toolkit.getPageCount() > 24) throw new Error('这版预览最多支持 24 页曲谱，请先选取较短片段。');
  const limit = toolkit.getPageCount();
  let maxWidth = 0;
  let height = 0;
  for (let i = 1; i <= limit; i++) {
    const page = parseXml(toolkit.renderToSVG(i));
    const root = page.documentElement;
    const box = root.getAttribute('viewBox')?.split(/\s+/).map(Number);
    if (!box || box.length !== 4) throw new Error('Verovio SVG 缺少 viewBox。');
    const width = box[2];
    const pageHeight = box[3];
    root.setAttribute('x', '0');
    root.setAttribute('y', String(height));
    root.setAttribute('width', String(width));
    root.setAttribute('height', String(pageHeight));
    maxWidth = Math.max(maxWidth, width);
    pages.push(new XMLSerializer().serializeToString(root));
    height += pageHeight + 60;
  }
  if (!pages.length) throw new Error('排版后没有可显示的谱面。');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxWidth} ${height}" width="${maxWidth}" height="${height}"><rect width="${maxWidth}" height="${height}" fill="#d9d4cb"/>${pages.join('')}</svg>`;
  return {svg, width: maxWidth, height, pageCount: toolkit.getPageCount()};
}

function measureGeometry(svg: string) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;width:1600px;pointer-events:none;visibility:hidden';
  host.innerHTML = svg;
  document.body.append(host);
  try {
    const root = host.querySelector('svg')!;
    const inverse = root.getScreenCTM()?.inverse();
    if (!inverse) throw new Error('浏览器无法测量曲谱坐标。');
    const geometry = new Map<string, Geometry>();
    for (const group of host.querySelectorAll<SVGGElement>('g.note')) {
      const head = group.querySelector<SVGGraphicsElement>('.notehead');
      if (!head) continue;
      const box = head.getBBox();
      const matrix = head.getScreenCTM();
      if (!matrix) continue;
      const point = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(inverse.multiply(matrix));
      const system = [...root.querySelectorAll('.system')].findIndex(node => node.contains(group));
      geometry.set(group.id, {x: point.x, y: point.y, system: Math.max(0, system)});
    }
    return geometry;
  } finally { host.remove(); }
}

export async function processFiles(scoreFile: File, midiFile: File, onStep: (s: string) => void): Promise<ScoreProject> {
  onStep('解析 MXL / MusicXML');
  const identified = identifyNotes(await readScore(scoreFile));
  onStep('Verovio 排版真实谱面');
  const engraved = await engrave(identified.xml);
  onStep('测量真实符头坐标');
  const geometry = measureGeometry(engraved.svg);
  if (!geometry.size) throw new Error('谱面已生成，但没有测到符头坐标。');
  onStep('读取 MIDI 并匹配音符');
  const midi = new Midi(await midiFile.arrayBuffer());
  const candidates = midi.tracks.map((track, trackIndex) => ({
    name: track.name.replace(/\0/g, '').trim(), instrument: track.instrument.name,
    program: track.instrument.number, notes: track.notes.length, track, trackIndex,
  }));
  const pianoTracks = selectPianoTracks(candidates);
  if (!pianoTracks.length) throw new Error('MIDI 中没有可识别的钢琴音轨；已停止钢琴谱映射，避免用其他乐器伪造落点。');
  const midiNotes: PianoMidiNote[] = pianoTracks.flatMap(({track, trackIndex, name}) => track.notes.map((note, noteIndex) => ({
    id: `midi-${trackIndex}-${noteIndex}`, time: note.time, duration: note.duration,
    beat: note.ticks / midi.header.ppq, pitch: note.midi, velocity: Math.round(note.velocity * 127),
    staff: 1 as const, trackName: name,
  })));
  identified.notes.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
  const mapping = matchPianoNotes(identified.notes, midiNotes, 0.8);
  const events: Activation[] = [];
  let unmatched = mapping.unmatched;
  for (const {score: target, midi: midiNote} of mapping.matches) {
    const position = geometry.get(target.id);
    if (!position) { unmatched++; continue; }
    events.push({eventId: midiNote.id, scoreId: target.id, time: midiNote.time, duration: midiNote.duration,
      pitch: midiNote.pitch, velocity: midiNote.velocity, staff: target.staff, x: position.x, y: position.y,
      system: position.system, kind: 'attack'});
  }
  if (!events.length) throw new Error('MIDI 与曲谱没有匹配的符头。请确认两者是同一版本，且音高与拍位一致。');
  // Crop the large engraving page around the actual note geometry. Keep a
  // generous left margin for clefs/key signatures and vertical staff context.
  const positions = [...geometry.values()];
  const left = Math.max(0, Math.floor(Math.min(...positions.map(p => p.x)) - 170));
  const top = Math.max(0, Math.floor(Math.min(...positions.map(p => p.y)) - 125));
  const right = Math.min(engraved.width, Math.ceil(Math.max(...positions.map(p => p.x)) + 115));
  const bottom = Math.min(engraved.height, Math.ceil(Math.max(...positions.map(p => p.y)) + 120));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const cropped = parseXml(engraved.svg);
  cropped.documentElement.setAttribute('viewBox', `${left} ${top} ${width} ${height}`);
  cropped.documentElement.setAttribute('width', String(width));
  cropped.documentElement.setAttribute('height', String(height));
  for (const event of events) { event.x -= left; event.y -= top; }
  const title = parseXml(identified.xml).querySelector('work-title, movement-title')?.textContent?.trim() || scoreFile.name.replace(/\.(mxl|musicxml|xml)$/i, '');
  return {title, subtitle: '钢琴双手专属谱面 · 完整 MIDI 合奏播放', svg: new XMLSerializer().serializeToString(cropped.documentElement), width, height,
    duration: Math.max(midi.duration, 1), events, midiCount: midiNotes.length,
    unmatched, pageCount: engraved.pageCount, sample: false, partCount: identified.partCount,
    pianoPartName: identified.pianoPartName, pianoTrackNames: pianoTracks.map(track => track.name || track.instrument),
    pianoMatchedCount: events.length, midiTrackCount: midi.tracks.length,
    soundingTrackCount: midi.tracks.filter(track => track.notes.length > 0).length};
}
