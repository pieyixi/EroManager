import { invokeTauri } from '../tauri';
import type {
  ArchiveDraft,
  ArchiveEpisodeCoverInput,
  ArchiveSaveInput,
} from '../contracts/archive';

export const archiveApi = {
  ensureDataDir: (dirPath: string) => invokeTauri<string>('ensure_archive_data_dir', { dirPath }),
  inspectFolder: (dirPath: string) => invokeTauri<ArchiveDraft>('inspect_archive_folder', { dirPath }),
  saveDraft: (input: ArchiveSaveInput) => invokeTauri<string>('save_archive_draft', { input }),
  saveJson: (dirPath: string, jsonText: string) => invokeTauri<string>('save_archive_json', { dirPath, jsonText }),
  saveCover: (input: { dir_path: string; image_data: string; episode_id?: number }) =>
    invokeTauri<string>('save_archive_cover', { input }),
  saveEpisodeCovers: (dirPath: string, covers: ArchiveEpisodeCoverInput[]) =>
    invokeTauri<string[]>('save_archive_episode_covers', { input: { dir_path: dirPath, covers } }),
};
