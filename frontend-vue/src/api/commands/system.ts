import { invokeTauri } from '../tauri';

export const systemApi = {
  openFolder: (path: string) => invokeTauri<void>('open_folder', { path }),
};
