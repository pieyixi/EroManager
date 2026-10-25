import { describe, expect, it } from 'vitest';
import { createAvScene } from '../../api/mock/avScene';
import { avPlaybackKey, avPlayerEpisodes } from './avPlayback';
describe('AV playlist identity', () => {
  it('keeps original above cut regardless of incoming order and uses version labels', () => {
    const work = createAvScene()[0]!; work.videos.reverse();
    const playlist = avPlayerEpisodes(work);
    expect(playlist.map(video => video.title)).toEqual(['原版','剪辑版']);
    expect(playlist.map(video => video.id)).toEqual([1,2]);
    expect(playlist[1]!.video_path).toContain('/cut');
    expect(avPlayerEpisodes(createAvScene()[3]!)[0]!.title).toBe('剪辑版');
    expect(avPlayerEpisodes(createAvScene()[2]!)).toEqual([]);
  });
  it('separates progress by exact number and version instead of reusing media episode IDs', () => {
    expect(new Set([avPlaybackKey('IPX-607',1),avPlaybackKey('IPX-607',2),avPlaybackKey('IPX-608',1)]).size).toBe(3);
  });
});
