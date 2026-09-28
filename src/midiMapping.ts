export type TrackCandidate = {
  name: string;
  instrument: string;
  program: number;
  notes: number;
};

export type PianoScoreNote = {id: string; beat: number; pitch: number; staff: 1 | 2};
export type PianoMidiNote = {
  id: string;
  beat: number;
  time: number;
  duration: number;
  pitch: number;
  velocity: number;
  staff: 1 | 2;
};

export function selectPianoTracks<T extends TrackCandidate>(tracks: T[]): T[] {
  const sounding = tracks.filter(track => track.notes > 0);
  const namedPiano = sounding.filter(track => /piano|keyboard/i.test(`${track.name} ${track.instrument}`));
  if (namedPiano.length) return namedPiano;
  return sounding.filter(track => track.program >= 0 && track.program <= 7);
}

export function matchPianoNotes(
  scoreNotes: PianoScoreNote[],
  midiNotes: PianoMidiNote[],
  maxBeatDelta = 0.8,
) {
  const scoreByPitch = new Map<number, PianoScoreNote[]>();
  for (const note of [...scoreNotes].sort((a, b) => a.beat - b.beat || a.staff - b.staff)) {
    const samePitch = scoreByPitch.get(note.pitch) || [];
    samePitch.push(note);
    scoreByPitch.set(note.pitch, samePitch);
  }
  const used = new Set<string>();
  const matches: Array<{score: PianoScoreNote; midi: PianoMidiNote}> = [];
  let unmatched = 0;
  for (const midi of [...midiNotes].sort((a, b) => a.time - b.time || a.pitch - b.pitch)) {
    const candidates = scoreByPitch.get(midi.pitch) || [];
    let best: PianoScoreNote | undefined;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      if (used.has(candidate.id)) continue;
      const delta = Math.abs(candidate.beat - midi.beat);
      if (delta < bestDelta) { best = candidate; bestDelta = delta; }
      if (candidate.beat > midi.beat && delta > bestDelta) break;
    }
    if (!best || bestDelta > maxBeatDelta) { unmatched++; continue; }
    used.add(best.id);
    matches.push({score: best, midi});
  }
  return {matches, unmatched};
}
