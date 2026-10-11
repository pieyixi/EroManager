import { invokeTauri } from '../tauri';
import type { CapturePath, CapturedFrameData, TimelineThumbnailFrame } from '../contracts/player';

export const playerApi = {
  setFullscreen: (enabled: boolean) => invokeTauri<void>('set_player_fullscreen', { enabled }),
  playExternal: (videoPath: string) => invokeTauri<void>('play_video', { videoPath }),
  prepareCapture: () => invokeTauri<CapturePath>('prepare_temp_frame_capture'),
  readImage: (path: string) => invokeTauri<CapturedFrameData>('read_image_data', { path }),
  primeThumbnail: (videoPath: string, generation: number) => invokeTauri<CapturedFrameData>('prime_video_thumbnail', { videoPath, generation }),
  prefetchThumbnails: (videoPath: string, times: number[], generation: number) => invokeTauri<TimelineThumbnailFrame[]>('prefetch_video_thumbnails', { videoPath, times, generation }),
  getThumbnail: (videoPath: string, time: number, exact: boolean, generation: number) => invokeTauri<CapturedFrameData>('get_video_thumbnail', { videoPath, time, exact, generation }),
  releaseThumbnails: (generation: number) => invokeTauri<void>('release_video_thumbnail_decoders', { generation }),
};
