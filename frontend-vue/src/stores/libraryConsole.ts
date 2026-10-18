import { defineStore } from 'pinia';
import { pickDirectory } from '../api/tauri';
import { libraryApi } from '../api/commands/library';
import { settingsApi } from '../api/commands/settings';
import { systemApi } from '../api/commands/system';
import type {
  ConsoleItem,
  DuplicateGroup,
  LibraryScan,
  LibrarySummary,
  MediaLibraryStatus,
} from '../api/contracts/library';
import type { BackupProgressEvent, UiMessage } from '../api/contracts/settings';
import { useLibraryStore } from './library';
import { useNavigationStore } from './navigation';

export type { ConsoleItem, LibraryScan, LibrarySummary, MediaLibraryStatus } from '../api/contracts/library';
const summaryLoads = new WeakMap<object, { path: string; promise: Promise<boolean> }>();

export function isMissingDirectoryItem(item: ConsoleItem): boolean {
  return Number.isInteger(item.work_id) && item.status === '作品目录不存在';
}

export function formatLibrarySize(bytes: number): string {
  let value = Number(bytes || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${index < 3 ? Math.round(value) : value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sourceLabel(source: string): string {
  return ({
    database: '已从现有数据库建立便携媒体库',
    relative: '已按程序相对位置自动找到媒体库',
    previous: '已使用上次的媒体目录',
    'repaired-marker': '已修复媒体库标记',
    'drive-scan': '检测到盘符变化并自动找到媒体库',
    manual: '媒体库绑定成功',
    missing: '原媒体目录不可用，请填写移动后的媒体目录',
    unconfigured: '尚未设置媒体目录',
  } as Record<string, string>)[source] || '媒体库状态已更新';
}

export const useLibraryConsoleStore = defineStore('libraryConsole', {
  state: () => ({
    mediaPath: 'D:\\HAnime',
    mediaLibrary: null as MediaLibraryStatus | null,
    libraryMessage: null as UiMessage | null,
    databaseMessage: null as UiMessage | null,
    duplicateMessage: null as UiMessage | null,
    summary: { archived_count: 0, unarchived_count: 0, episode_count: 0, total_bytes: 0 } as LibrarySummary,
    summaryLoaded: false, summaryLoading: false, summaryError: '',
    scan: null as LibraryScan | null,
    scanning: false,
    backupRunning: false,
    progressActive: false,
    progressPercent: 0,
    progressText: '',
    backupPath: '',
    duplicates: [] as DuplicateGroup[],
  }),
  getters: {
    archivedCount: (state) => Number(state.summary.archived_count || 0),
    unarchivedCount: (state) => Number(state.summary.unarchived_count || 0),
    totalWorks(): number { return this.archivedCount + this.unarchivedCount; },
    archivePercent(): number { return this.totalWorks ? Math.round(this.archivedCount / this.totalWorks * 100) : 0; },
    formattedSize: (state) => formatLibrarySize(state.summary.total_bytes),
    busy: (state) => state.scanning || state.backupRunning,
    hasScanChanges: (state) => Boolean(state.scan && ['changed_works', 'new_episode_works', 'new_complete_works', 'attention_works']
      .some((key) => (state.scan?.[key as keyof LibraryScan] as ConsoleItem[] | undefined)?.length)),
    connected: (state) => Boolean(state.mediaLibrary && !state.mediaLibrary.needs_binding),
  },
  actions: {
    applyMediaLibraryStatus(status: MediaLibraryStatus | null): void {
      if (status?.root_path && status.root_path !== this.mediaPath) this.summaryLoaded = false;
      this.mediaLibrary = status;
      if (!status) return;
      if (status.root_path) this.mediaPath = status.root_path;
      let detail = sourceLabel(status.source);
      if (status.rebound_paths > 0) detail += `，已重绑定 ${status.rebound_paths} 条路径`;
      this.libraryMessage = status.needs_binding ? { kind: 'err', text: detail } : null;
    },
    async initializeMediaLibrary(): Promise<MediaLibraryStatus> {
      try {
        const status = await libraryApi.initializeMediaLibrary();
        this.applyMediaLibraryStatus(status);
        return status;
      } catch (error) {
        const status: MediaLibraryStatus = { root_path: null, library_id: null, source: 'unconfigured', rebound_paths: 0, needs_binding: true };
        this.applyMediaLibraryStatus(status);
        this.libraryMessage = { kind: 'err', text: `媒体库初始化失败: ${errorText(error)}` };
        return status;
      }
    },
    async openSettingsPage(): Promise<void> {
      useNavigationStore().showPage('page-settings');
      await this.loadSummary();
    },
    async bindMediaLibraryPath(path: string, showMessage: boolean): Promise<MediaLibraryStatus> {
      const status = await libraryApi.bindMediaLibrary(path);
      this.applyMediaLibraryStatus(status);
      if (showMessage && status.rebound_paths > 0) {
        this.libraryMessage = { kind: 'success', text: `媒体库已连接，已更新 ${status.rebound_paths} 条路径` };
      }
      return status;
    },
    async ensureMediaLibraryPath(path: string): Promise<MediaLibraryStatus | null> {
      const current = this.mediaLibrary?.root_path;
      if (!current || current.toLowerCase() !== path.toLowerCase()) return this.bindMediaLibraryPath(path, false);
      return this.mediaLibrary;
    },
    async bindMediaLibrary(): Promise<void> {
      const selected = await pickDirectory(this.mediaPath.trim());
      if (!selected) return;
      this.mediaPath = selected;
      this.libraryMessage = { kind: 'info', text: '正在验证媒体库...' };
      try {
        await this.bindMediaLibraryPath(selected, true);
        await useLibraryStore().reload({ resetFilters: false, clearCoverCache: true });
        this.scan = null;
        await this.loadSummary();
      } catch (error) {
        this.libraryMessage = { kind: 'err', text: `绑定失败: ${errorText(error)}` };
      }
    },
    async loadSummary(): Promise<boolean> {
      const path = this.mediaPath.trim();
      if (!path) return false;
      const pending = summaryLoads.get(this);
      if (pending?.path === path) return pending.promise;
      this.summaryLoading = true; this.summaryError = '';
      const promise = (async () => {
        try {
          const result = await libraryApi.getSummary(path);
          if (path !== this.mediaPath.trim()) return false;
          this.summary = result; this.summaryLoaded = true;
          if (this.libraryMessage?.text.startsWith('统计失败：')) this.libraryMessage = null;
          return true;
        } catch (error) {
          if (path === this.mediaPath.trim()) {
            this.summaryError = `统计失败：${errorText(error)}`;
            this.libraryMessage = { kind: 'err', text: this.summaryError };
          }
          return false;
        }
      })();
      summaryLoads.set(this, { path, promise });
      try { return await promise; }
      finally { if (summaryLoads.get(this)?.promise === promise) { summaryLoads.delete(this); this.summaryLoading = false; } }
    },
    setProgress(active: boolean, percent: number, text: string): void {
      this.progressActive = active;
      this.progressPercent = Math.max(0, Math.min(100, percent));
      this.progressText = text;
    },
    items(group: keyof Pick<LibraryScan, 'changed_works' | 'new_episode_works' | 'new_complete_works' | 'attention_works'>): ConsoleItem[] {
      return this.scan?.[group] || [];
    },
    async openConsoleFolder(group: keyof LibraryScan, index: number): Promise<void> {
      const item = (this.scan?.[group] as ConsoleItem[] | undefined)?.[index];
      if (item) await systemApi.openFolder(item.folder_path);
    },
    async deleteMissingDatabaseRecord(index: number): Promise<void> {
      const item = this.items('attention_works')[index];
      if (!item || !isMissingDirectoryItem(item) || item.work_id == null) return;
      const confirmed = await useNavigationStore().askConfirm(
        '删除数据库记录',
        `作品“${item.title}”的目录已经不存在。确定只删除它的数据库记录？此操作不会删除任何磁盘文件。`,
        '删除记录',
        true,
      );
      if (!confirmed) return;
      try {
        await libraryApi.deleteWork(item.work_id);
        if (this.scan) this.scan.attention_works.splice(index, 1);
        await Promise.all([
          useLibraryStore().reload({ resetFilters: false, clearCoverCache: true }),
          this.loadSummary(),
        ]);
        this.libraryMessage = { kind: 'success', text: `已删除“${item.title}”的数据库记录` };
      } catch (error) {
        this.libraryMessage = { kind: 'err', text: `删除记录失败：${errorText(error)}` };
      }
    },
    async scanLibraryChanges(): Promise<void> {
      const path = this.mediaPath.trim();
      if (!path || this.busy) return;
      this.scanning = true;
      this.scan = null;
      let percent = 8;
      this.setProgress(true, percent, '正在检查目录和视频');
      const timer = window.setInterval(() => {
        percent = Math.min(88, percent + Math.max(1, Math.round((88 - percent) * 0.08)));
        const text = percent < 42 ? '正在检查目录和视频' : percent < 72 ? '正在比对元数据和封面' : '正在计算媒体库容量';
        this.setProgress(true, percent, text);
      }, 220);
      try {
        await this.ensureMediaLibraryPath(path);
        this.scan = await libraryApi.scanChanges(path);
        this.summary = this.scan.summary;
        this.summaryLoaded = true;
        window.clearInterval(timer);
        this.setProgress(true, 100, '扫描完成');
        window.setTimeout(() => this.setProgress(false, 0, ''), 650);
      } catch (error) {
        window.clearInterval(timer);
        this.setProgress(false, 0, '');
        this.libraryMessage = { kind: 'err', text: `扫描失败：${errorText(error)}` };
      } finally {
        this.scanning = false;
      }
    },
    async applyLibraryUpdates(): Promise<void> {
      const items = this.items('changed_works').filter((item) => item.can_update);
      if (!items.length) return;
      const confirmed = await useNavigationStore().askConfirm('全部更新', `将按当前文件重新导入 ${items.length} 个已建档作品，数据库中的对应信息会完整更新。`, '确认更新');
      if (!confirmed) return;
      try {
        this.setProgress(true, 35, '正在更新已建档作品');
        await settingsApi.applyLibraryUpdates(items.map((item) => item.folder_path));
        this.setProgress(true, 100, '更新完成');
        await useLibraryStore().reload({ resetFilters: false, clearCoverCache: true });
        await this.scanLibraryChanges();
      } catch (error) {
        this.setProgress(false, 0, '');
        this.libraryMessage = { kind: 'err', text: `更新失败：${errorText(error)}` };
      }
    },
    async importConsoleWorks(): Promise<void> {
      const items = this.items('new_complete_works');
      if (!items.length) return;
      const confirmed = await useNavigationStore().askConfirm('导入新作品', `将把 ${items.length} 个建档完整的新作品导入主库。`, '确认导入');
      if (!confirmed) return;
      try {
        this.setProgress(true, 35, '正在导入新作品');
        await settingsApi.importFolders(items.map((item) => item.folder_path));
        this.setProgress(true, 100, '导入完成');
        await useLibraryStore().reload({ resetFilters: false, clearCoverCache: true });
        await this.scanLibraryChanges();
      } catch (error) {
        this.setProgress(false, 0, '');
        this.libraryMessage = { kind: 'err', text: `导入失败：${errorText(error)}` };
      }
    },
    async duplicateCheck(): Promise<void> {
      const path = this.mediaPath.trim();
      if (!path) return;
      this.duplicateMessage = { kind: 'info', text: '查重中...' };
      this.duplicates = [];
      try {
        await this.ensureMediaLibraryPath(path);
        this.duplicates = await libraryApi.detectDuplicates(path);
        this.duplicateMessage = { kind: this.duplicates.length ? 'err' : 'info', text: this.duplicates.length ? `发现 ${this.duplicates.length} 组疑似重复` : '未发现重复作品' };
      } catch (error) {
        this.duplicateMessage = { kind: 'err', text: `查重失败: ${errorText(error)}` };
      }
    },
    async backupDatabase(): Promise<void> {
      const path = this.backupPath.trim() || 'D:\\HAnime\\backup.db';
      try {
        await settingsApi.backupDatabase(path);
        this.databaseMessage = { kind: 'info', text: `备份成功: ${path}` };
      } catch (error) {
        this.databaseMessage = { kind: 'err', text: `备份失败: ${errorText(error)}` };
      }
    },
    async backupDataPackage(): Promise<void> {
      if (this.busy) return;
      const path = this.backupPath.trim() || 'D:\\Ark\\ero-data-backup.zip';
      this.backupRunning = true;
      this.databaseMessage = null;
      this.setProgress(true, 1, '正在准备资料包备份');
      let stopProgress: (() => void) | undefined;
      try {
        stopProgress = await settingsApi.listenBackupProgress((progress: BackupProgressEvent) => {
          this.setProgress(true, progress.percent, progress.text);
        });
        const result = await settingsApi.backupDataPackage(path);
        this.setProgress(true, 100, '资料包备份完成');
        this.databaseMessage = { kind: 'info', text: `资料包备份成功: ${result}` };
        await new Promise((resolve) => window.setTimeout(resolve, 650));
      } catch (error) {
        this.databaseMessage = { kind: 'err', text: `资料包备份失败: ${errorText(error)}` };
      } finally {
        stopProgress?.();
        this.backupRunning = false;
        this.setProgress(false, 0, '');
      }
    },
    async restoreDatabase(): Promise<void> {
      const path = this.backupPath.trim();
      if (!path) return;
      try {
        await settingsApi.restoreDatabase(path);
        this.databaseMessage = { kind: 'info', text: '恢复成功，请重启应用' };
      } catch (error) {
        this.databaseMessage = { kind: 'err', text: `恢复失败: ${errorText(error)}` };
      }
    },
  },
});
