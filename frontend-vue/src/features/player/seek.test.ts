import { describe, expect, it } from 'vitest';
import type { PlayerStore } from '../../stores/player';
import { createPlayerSeekController } from './seek';

function fakePlayer(): PlayerStore {
  return {
    libmpvReady: true,
    duration: 100,
    currentTime: 0,
    editingTime: false,
    timeInput: '00:00',
    pendingSeek: null,
    seekCommandRunning: false,
    isSeeking: false,
    paused: false,
    keySeekDirection: 0,
  } as PlayerStore;
}

describe('player seek controller', () => {
  it('clamps an exact seek and keeps transport outside the store', async () => {
    const player = fakePlayer();
    const commands: unknown[][] = [];
    const controller = createPlayerSeekController({
      player,
      isPlayerActive: () => true,
      thumbnails: { show: () => 0, hide: () => undefined },
      seekRelative: async () => undefined,
      setSpeed: async () => undefined,
      pollStatus: async () => undefined,
      mpvCommand: async (name, args = []) => {
        commands.push([name, ...args]);
      },
      mpvSetProperty: async () => undefined,
      formatTime: (seconds) => `${seconds}`,
      message: () => undefined,
    });

    await controller.seekTo(140);
    await Promise.resolve();
    await Promise.resolve();

    expect(player.currentTime).toBe(140);
    expect(commands).toEqual([['seek', 100, 'absolute+exact']]);
  });
});
