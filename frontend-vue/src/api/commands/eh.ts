import { invokeTauri } from '../tauri';
import type {
  EhDownloadInput,
  EhDownloadProgressEvent,
  EhDownloadResult,
  HitomiDownloadInput,
  EhGallerySummary,
  EhLibraryOverview,
  EhReaderPage,
} from '../contracts/eh';
import { listenTauri } from '../tauri';

export const ehApi = {
  getOverview: () => invokeTauri<EhLibraryOverview>('eh_get_library_overview'),
  listGalleries: () => invokeTauri<EhGallerySummary[]>('eh_list_local_galleries'),
  getPages: (gid: number) => invokeTauri<EhReaderPage[]>('eh_get_gallery_pages', { gid }),
  deleteRecord: (gid: number) => invokeTauri<void>('eh_delete_gallery_record', { gid }),
  deleteFolder: (gid: number) => invokeTauri<void>('eh_delete_gallery_folder', { gid }),
  downloadGallery: (input: EhDownloadInput) => invokeTauri<EhDownloadResult>('eh_download_gallery', { input }),
  downloadHitomi: (input: HitomiDownloadInput) => invokeTauri<EhDownloadResult>('hitomi_download_gallery', { input }),
  deleteHitomiFolder: (id: number) => invokeTauri<void>('hitomi_delete_gallery_folder', { id }),
  listenDownloadProgress: (handler: (event: EhDownloadProgressEvent) => void) => listenTauri<EhDownloadProgressEvent>('eh-download-progress', handler),
  listenHitomiProgress: (handler: (event: EhDownloadProgressEvent) => void) => listenTauri<EhDownloadProgressEvent>('hitomi-download-progress', handler),
};
