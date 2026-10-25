import { accountScope } from '../../api/accountContext';
import { watch } from 'vue';
import type { PlayerEpisode } from '../../api/contracts/library';
import { preferencesApi } from '../../api/commands/preferences';
import { accountApi } from '../../api/commands/accounts';
import { avPlaybackKey } from './avPlayback';
import { usePreferencesStore } from '../../stores/preferences';
import type { PlayerStore } from '../../stores/player';
import { mpvCommand } from './mpv';

export function playbackResumePosition(position: number, duration: number): number {
  if (!Number.isFinite(position) || position < 0 || !Number.isFinite(duration) || duration <= 0) return 0;
  return position >= duration - 3 ? 0 : Math.min(position, duration);
}
export function shouldAdvanceEpisode(ended: boolean, loop: string, autoNext: boolean): boolean {
  return ended && (autoNext || loop === 'random') && loop !== 'one';
}



export function createPlayerPreferences(options: {
  player: PlayerStore; report(text: string): void; pollStatus(): Promise<void>;
  setVolume(value: number): Promise<void>; setSpeed(value: number): Promise<void>;
  setLoop(value: string): Promise<void>; applyFit(): Promise<void>;
  avCode?(): string;
}) {
  const { player } = options;
  const preferences = usePreferencesStore();
  function save(): void {
    if (!preferences.loaded || !preferences.values.remember_playback || !['detail','av'].includes(player.mode) || !player.episode?.id || player.videoLoading) return;
    if (!Number.isFinite(player.duration) || player.duration <= 0) return;
    if (player.mode === 'av') {
      const code = options.avCode?.(); if (!code) return;
      void accountApi.set('av-playback', avPlaybackKey(code, player.episode.id), JSON.stringify({position: playbackResumePosition(player.currentTime, player.duration)}))
        .catch(() => options.report('播放位置尚未保存，请检查数据库是否可写'));
      return;
    }
    void preferencesApi.setRecord({ kind: 'media', content_id: Number(player.episode.id),
      position: playbackResumePosition(player.currentTime, player.duration), pair_offset: 1, merged_pairs: [] })
      .catch(() => options.report('播放位置尚未保存，请检查数据库是否可写'));
  }
  async function resume(episode: PlayerEpisode): Promise<void> {
    if (!preferences.loaded || !preferences.values.remember_playback || !['detail','av'].includes(player.mode) || !episode.id) return;
    try {
      const owner = accountScope(), mode = player.mode, code = options.avCode?.();
      const record = mode === 'av'
        ? JSON.parse(await accountApi.get('av-playback', avPlaybackKey(code || '', episode.id)) || 'null') as {position:number} | null
        : await preferencesApi.getRecord('media', Number(episode.id));
      if (owner !== accountScope()) return;
      if (player.mode !== mode || (mode === 'av' && code !== options.avCode?.()) || player.episode?.id !== episode.id || player.episode?.video_path !== episode.video_path) return;
      const position = playbackResumePosition(record?.position || 0, player.duration);
      if (position) { await mpvCommand('seek', [position, 'absolute+exact']); await options.pollStatus(); }
    } catch { options.report('播放记录读取失败，本次从头播放'); }
  }
  const dispose = watch(() => [preferences.loaded, preferences.values.player_volume,
    preferences.values.player_speed, preferences.values.player_loop, preferences.values.player_fit] as const,
  (next, previous) => {
    if (!next[0]) return;
    if (next[1] !== previous?.[1] || !previous?.[0]) { player.volume = next[1]; if (player.libmpvReady) void options.setVolume(next[1]); }
    if (next[2] !== previous?.[2] || !previous?.[0]) { player.speed = next[2]; if (player.libmpvReady) void options.setSpeed(next[2]); }
    if (next[3] !== previous?.[3] || !previous?.[0]) { player.loopMode = player.mode === 'av' && next[3] === 'random' ? 'off' : next[3]; if (player.libmpvReady) void options.setLoop(player.loopMode); }
    if (next[4] !== previous?.[4] || !previous?.[0]) { player.fitMode = next[4]; void options.applyFit(); }
  });
  return { save, resume, dispose };
}
