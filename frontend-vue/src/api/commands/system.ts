import { invokeTauri } from '../tauri';

export const systemApi = {
  openFolder: (path: string) => invokeTauri<void>('open_folder', { path }),
  closeApplication: (action: 'tray' | 'exit') => invokeTauri<void>('apply_close_action', { action }),
};
