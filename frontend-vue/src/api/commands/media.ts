import { invokeTauri } from '../tauri';

export const mediaApi = {
  loadImages: (paths: string[]) => invokeTauri<Array<[string, string]>>('load_cover_cache', { coverPaths: paths }),
};
