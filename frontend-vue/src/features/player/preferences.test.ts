import { describe, expect, it } from 'vitest';
import { playbackResumePosition, shouldAdvanceEpisode } from './preferences';
describe('playback preferences and progress', () => {
  it('keeps automatic continuation independent from list wrap and single-episode repeat', () => {
    expect(shouldAdvanceEpisode(true,'all',false)).toBe(false);
    expect(shouldAdvanceEpisode(true,'off',true)).toBe(true);
    expect(shouldAdvanceEpisode(true,'one',true)).toBe(false);
    expect(shouldAdvanceEpisode(false,'all',true)).toBe(false);
    expect(shouldAdvanceEpisode(true,'random',false)).toBe(true);
    expect(shouldAdvanceEpisode(false,'random',true)).toBe(false);
  });
  it('resumes unfinished episodes but starts completed or invalid positions from the beginning', () => {
    expect(playbackResumePosition(40,120)).toBe(40);
    expect(playbackResumePosition(119,120)).toBe(0);
    expect(playbackResumePosition(160,120)).toBe(0);
    expect(playbackResumePosition(-1,120)).toBe(0);
    expect(playbackResumePosition(20,0)).toBe(0);
    expect(playbackResumePosition(NaN,120)).toBe(0);
  });
});
