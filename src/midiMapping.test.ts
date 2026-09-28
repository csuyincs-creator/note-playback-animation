import {describe, expect, it} from 'vitest';
import {matchPianoNotes, selectPianoTracks} from './midiMapping';

describe('piano track detection', () => {
  it('selects both grand piano hands and excludes every ensemble instrument', () => {
    const tracks = [
      {name: 'Flute', instrument: 'flute', program: 73, notes: 334},
      {name: 'Grand Piano', instrument: 'acoustic grand piano', program: 0, notes: 593},
      {name: 'Grand Piano', instrument: 'acoustic grand piano', program: 0, notes: 442},
      {name: 'Glockenspiel', instrument: 'glockenspiel', program: 9, notes: 30},
    ];
    expect(selectPianoTracks(tracks).map(track => track.notes)).toEqual([593, 442]);
  });
});

describe('piano score mapping', () => {
  it('pairs repeated pitches by beat and does not reuse a score note', () => {
    const score = [
      {id: 's1', beat: 0, pitch: 60, staff: 1 as const},
      {id: 's2', beat: 1, pitch: 60, staff: 1 as const},
    ];
    const midi = [
      {id: 'm1', beat: 0.02, time: 0, duration: 0.4, pitch: 60, velocity: 90, staff: 1 as const},
      {id: 'm2', beat: 1.03, time: 0.8, duration: 0.4, pitch: 60, velocity: 90, staff: 1 as const},
    ];
    const result = matchPianoNotes(score, midi);
    expect(result.matches.map(match => [match.score.id, match.midi.id])).toEqual([['s1', 'm1'], ['s2', 'm2']]);
    expect(result.unmatched).toBe(0);
  });

  it('counts far beat mismatches rather than inventing a landing point', () => {
    const result = matchPianoNotes(
      [{id: 's1', beat: 8, pitch: 60, staff: 1}],
      [{id: 'm1', beat: 1, time: 0, duration: 0.4, pitch: 60, velocity: 90, staff: 1}],
      0.8,
    );
    expect(result.matches).toHaveLength(0);
    expect(result.unmatched).toBe(1);
  });

  it('maps simultaneous octave doublings to distinct score notes', () => {
    const result = matchPianoNotes(
      [
        {id: 'low', beat: 2, pitch: 48, staff: 2},
        {id: 'high', beat: 2, pitch: 60, staff: 1},
      ],
      [
        {id: 'm-low', beat: 2, time: 1, duration: 0.5, pitch: 48, velocity: 70, staff: 2},
        {id: 'm-high', beat: 2, time: 1, duration: 0.5, pitch: 60, velocity: 85, staff: 1},
      ],
    );
    expect(result.matches.map(match => match.score.id)).toEqual(['low', 'high']);
  });
});
