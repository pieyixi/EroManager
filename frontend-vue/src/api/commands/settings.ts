import { invokeTauri, listenTauri } from '../tauri';
import type {
  BackupProgressEvent,
  EhLibraryDashboard,
  EhScanProgressEvent,
  EhScanResult,
  EhSettings,
} from '../contracts/settings';
import type { LibraryScan, MediaLibraryStatus } from '../contracts/library';
import type { SaveEhSettingsInput } from '../contracts/eh';

export const settingsApi = {
  saveEhSettings: (input: SaveEhSettingsInput) =>
    invokeTauri<EhSettings>('eh_save_settings', { input }),
  getEhSettings: () => invokeTauri<EhSettings>('eh_get_settings'),
  bindEhLibrary: (rootPath: string) => invokeTauri<EhSettings>('eh_bind_local_library', { rootPath }),
  getEhDashboard: () => invokeTauri<EhLibraryDashboard>('eh_get_library_dashboard'),
  scanEhLibrary: (rootPath: string) => invokeTauri<EhScanResult>('eh_scan_local_library', { rootPath }),
  listenEhProgress: (handler: (event: EhScanProgressEvent) => void) => listenTauri<EhScanProgressEvent>('eh-scan-progress', handler),
  listenBackupProgress: (handler: (event: BackupProgressEvent) => void) => listenTauri<BackupProgressEvent>('backup-data-package-progress', handler),
  applyLibraryUpdates: (folders: string[]) => invokeTauri<number>('apply_library_updates', { folders }),
  importFolders: (folders: string[]) => invokeTauri<number>('batch_import_folders', { folders }),
  backupDatabase: (backupPath: string) => invokeTauri<void>('backup_database', { backupPath }),
  backupDataPackage: (backupPath: string) => invokeTauri<string>('backup_data_package', { backupPath }),
  restoreDatabase: (restorePath: string) => invokeTauri<void>('restore_database', { restorePath }),
};

export type { LibraryScan, MediaLibraryStatus };
