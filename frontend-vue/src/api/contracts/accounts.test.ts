import { describe, expect, it } from 'vitest';
import { normalizePrivacy } from './accounts';
describe('retired privacy timer options', () => {
  it('turns retired custom/short-delay values off without altering the other boundaries', () => {
    const previous = { idle_seconds: 420, background_seconds: 15, minimize: true, system: false, while_playing: true };
    expect(normalizePrivacy(previous)).toEqual({ ...previous, idle_seconds: 0, background_seconds: 0 });
    expect(previous.idle_seconds).toBe(420);
  });
  it('keeps all current timer presets, including sixty-minute idle and thirty-minute background', () => {
    expect(normalizePrivacy({ idle_seconds: 3600, background_seconds: 1800 })).toMatchObject({ idle_seconds: 3600, background_seconds: 1800 });
    expect(normalizePrivacy({ idle_seconds: 300, background_seconds: 1 })).toMatchObject({ idle_seconds: 300, background_seconds: 1 });
  });
});
