import {describe, expect, it} from 'vitest';
import {performanceAt} from './performance';
import type {Activation} from './types';

const landings: Activation[] = [1, 2, 4].map((time, index) => ({
  eventId: `event-${index}`,
  scoreId: `score-${index}`,
  time,
  duration: .4,
  pitch: 60 + index,
  velocity: 90,
  staff: 1,
  x: index * 100,
  y: 20,
  system: 0,
  kind: 'attack',
}));

describe('performance timeline lookup', () => {
  it('selects the same landing before, at, between, and after note times', () => {
    expect(performanceAt(landings, 0).to.scoreId).toBe('score-0');
    expect(performanceAt(landings, .99).to.scoreId).toBe('score-0');
    expect(performanceAt(landings, 1).to.scoreId).toBe('score-1');
    expect(performanceAt(landings, 1.99).to.scoreId).toBe('score-1');
    expect(performanceAt(landings, 2).to.scoreId).toBe('score-1');
    expect(performanceAt(landings, 4).to.scoreId).toBe('score-2');
    expect(performanceAt(landings, 5).to.scoreId).toBe('score-2');
  });
});
