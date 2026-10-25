import type { AvWork } from '../../api/contracts/av';
import type { PlayerEpisode } from '../../api/contracts/library';

export function avPlayerEpisodes(work: AvWork | null): PlayerEpisode[] {
  return [...(work?.videos || [])].sort((a,b) => a.id-b.id).map(video => ({
    id: video.id, number: video.id, title: video.kind === 'cut' ? '剪辑版' : '原版',
    subtitle: video.file_name, video_path: video.video_path, cover_path: work?.cover,
    release_date: work?.release_date,
  }));
}
export function avPlaybackKey(code: string, episodeId: number): string {
  return `${code}:${episodeId === 2 ? 'cut' : 'original'}`;
}
