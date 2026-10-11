import { invokeTauri } from '../tauri';
import type {
  DuplicateGroup,
  LibrarySummary,
  LibraryScan,
  MediaLibraryStatus,
  TagSummary,
  UnarchivedItem,
  WorkDetail,
  WorkSummary,
} from '../contracts/library';

export const libraryApi = {
  initializeMediaLibrary: () => invokeTauri<MediaLibraryStatus>('initialize_media_library'),
  bindMediaLibrary: (rootPath: string) => invokeTauri<MediaLibraryStatus>('bind_media_library', { rootPath }),
  listWorks: () => invokeTauri<WorkSummary[]>('get_all_works_with_tags'),
  listTags: () => invokeTauri<TagSummary[]>('get_tags'),
  listStudios: () => invokeTauri<string[]>('get_studios'),
  listFavoriteCharacters: () => invokeTauri<string[]>('get_favorite_characters'),
  setCharacterFavorite: (characterName: string, favorite: boolean) =>
    invokeTauri<string[]>('set_character_favorite', { characterName, favorite }),
  getWorkDetail: (workId: number) => invokeTauri<WorkDetail>('get_work_detail', { workId }),
  importWork: (dirPath: string) => invokeTauri<number>('import_work_via_json', { dirPath }),
  deleteWork: (workId: number) => invokeTauri<void>('delete_work', { workId }),
  listUnarchivedFolders: (rootPath: string) => invokeTauri<UnarchivedItem[]>('list_unarchived_folders', { rootPath }),
  getSummary: (rootPath: string) => invokeTauri<LibrarySummary>('get_library_console_summary', { rootPath }),
  scanChanges: (rootPath: string) => invokeTauri<LibraryScan>('scan_library_changes', { rootPath }),
  detectDuplicates: (rootPath: string) => invokeTauri<DuplicateGroup[]>('detect_duplicates', { rootPath }),
};
