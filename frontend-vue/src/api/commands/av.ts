import { invokeTauri } from '../tauri';
import { accountScope } from '../accountContext';
import type { AvWork, AvVideo, AvSettings, AvFetchResult } from '../contracts/av';

export const avApi = {
  listWorks: () => invokeTauri<AvWork[]>('av_list_works', { scope: accountScope() }),
  settings: () => invokeTauri<AvSettings>('av_get_settings', { scope: accountScope() }),
  bindRoot: (rootPath: string) => invokeTauri<AvSettings>('av_bind_root', { scope: accountScope(), rootPath }),
  fetchWork: (code: string, scope = accountScope(), queuedAt = Date.now()) => invokeTauri<AvFetchResult>('av_fetch_work', { scope, code, queuedAt }),
  addMagnet: (code: string, magnet: string) => invokeTauri<AvWork>('av_add_magnet', { scope: accountScope(), code, magnet }),
  removeMagnet: (code: string, magnet: string) => invokeTauri<AvWork>('av_remove_magnet', { scope: accountScope(), code, magnet }),
  localVideos: (code: string) => invokeTauri<AvVideo[]>('av_get_local_videos', { scope: accountScope(), code }),
};
