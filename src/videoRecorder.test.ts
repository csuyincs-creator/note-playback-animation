import {describe, expect, it} from 'vitest';
import {recordingFilename, supportedRecordingTypes} from './videoRecorder';

const mp4 = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2';
const webm = 'video/webm;codecs=vp9,opus';

describe('video recording format selection', () => {
  it('prefers MP4 and keeps WebM as a fallback', () => {
    expect(supportedRecordingTypes(() => true)).toEqual([
      mp4,
      'video/mp4',
      webm,
      'video/webm',
    ]);
  });

  it('offers WebM when the browser cannot encode MP4', () => {
    expect(supportedRecordingTypes(type => type.startsWith('video/webm'))).toEqual([
      webm,
      'video/webm',
    ]);
  });

  it('reports no recording option when the browser supports neither format', () => {
    expect(supportedRecordingTypes(() => false)).toEqual([]);
  });

  it('keeps the title in the filename and matches the detected container', () => {
    const date = new Date('2026-09-28T00:00:00.000Z');
    expect(recordingFilename('久石让《Summer》合奏版', mp4, date)).toBe('久石让《Summer》合奏版-2026-09-28.mp4');
    expect(recordingFilename('A/B: C', webm, date)).toBe('A-B- C-2026-09-28.webm');
    expect(recordingFilename('?', webm, date)).toBe('--2026-09-28.webm');
  });
});
