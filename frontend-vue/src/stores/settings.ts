import { defineStore } from 'pinia';
import { invokeTauri, listenTauri, pickDirectory } from '../api/tauri';
import { useAppStore } from './app';
import { useLibraryStore } from './library';
import { useEhLibraryStore } from './ehLibrary';
import { useNavigationStore } from './navigation';

export interface MediaLibraryStatus {
  root_path: string | null;
  source: string;
  rebound_paths: number;
  needs_binding: boolean;
}

interface LibrarySummary {
  archived_count: number;
  unarchived_count: number;
  episode_count: number;
  total_bytes: number;
}

export interface ConsoleItem {
  work_id?: number | null;
  title: string;
  status: string;
  folder_path: string;
  can_update?: boolean;
  new_episode_numbers?: number[];
}

export function isMissingDirectoryItem(item: ConsoleItem): boolean {
  return Number.isInteger(item.work_id) && item.status === '作品目录不存在';
}

export interface LibraryScan {
  summary: LibrarySummary;
  changed_works: ConsoleItem[];
  new_episode_works: ConsoleItem[];
  new_complete_works: ConsoleItem[];
  attention_works: ConsoleItem[];
}

interface BackupProgressEvent {
  percent: number;
  text: string;
}

interface EhScanProgressEvent {
  percent: number;
  text: string;
}

interface EhSettings {
  root_path: string;
  ipb_member_id: string;
  ipb_pass_hash: string;
  igneous: string;
}

interface EhScanResult {
  folders: number;
  indexed: number;
  created_meta: number;
  created_cover: number;
  removed_records: number;
  skipped: number;
  errors: EhScanIssue[];
}

interface EhScanIssue {
  title: string;
  folder_path: string;
  reason: string;
}

export interface EhCategoryMetric {
  category: number;
  label: string;
  count: number;
  bytes: number;
}

interface EhLibraryDashboard {
  total_count: number;
  total_pages: number;
  total_bytes: number;
  categories: EhCategoryMetric[];
}

interface DuplicateItem {
  title: string;
  source: string;
  video_count: number;
  total_size: number;
  folder_path: string;
}

interface DuplicateGroup {
  items: DuplicateItem[];
}

type MessageKind = 'info' | 'err' | 'success';

interface UiMessage {
  kind: MessageKind;
  text: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function displayWindowsPath(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) return `\\\\${path.slice(8)}`;
  return path.startsWith('\\\\?\\') ? path.slice(4) : path;
}

function summarizeEhScanErrors(errors: EhScanIssue[]): string {
  if (!errors.length) return '';
  const missingSource = errors.filter((error) => error.reason.includes('.ehviewer')).length;
  const missingCover = errors.filter((error) => error.reason.includes('无法建立封面')).length;
  const other = errors.length - missingSource - missingCover;
  const groups = [
    missingSource ? `缺少来源信息 ${missingSource}` : '',
    missingCover ? `缺少封面来源 ${missingCover}` : '',
    other ? `其他错误 ${other}` : '',
  ].filter(Boolean);
  return `失败 ${errors.length} 部（${groups.join('，')}）`;
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

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    mediaPath: 'D:\\HAnime',
    ehLibraryPath: '',
    ehMemberId: '',
    ehPassHash: '',
    ehIgneous: '',
    ehCredentialsSaving: false,
    ehCredentialsMessage: null as UiMessage | null,
    ehLibraryMessage: null as UiMessage | null,
    ehScanning: false,
    ehScanCompleted: false,
    ehScanErrors: [] as EhScanIssue[],
    ehProgressActive: false,
    ehProgressPercent: 0,
    ehProgressText: '',
    ehBackupPath: '',
    ehDataMessage: null as UiMessage | null,
    ehDashboard: { total_count: 0, total_pages: 0, total_bytes: 0, categories: [] } as EhLibraryDashboard,
    backupPath: '',
    libraryMessage: null as UiMessage | null,
    databaseMessage: null as UiMessage | null,
    duplicateMessage: null as UiMessage | null,
    summary: { archived_count: 0, unarchived_count: 0, episode_count: 0, total_bytes: 0 } as LibrarySummary,
    scan: null as LibraryScan | null,
    scanning: false,
    backupRunning: false,
    progressActive: false,
    progressPercent: 0,
    progressText: '',
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
  },

  actions: {
    sourceText(source: string): string {
      const labels: Record<string, string> = {
        database: '已从现有数据库建立便携媒体库',
        relative: '已按程序相对位置自动找到媒体库',
        previous: '已使用上次的媒体目录',
        'repaired-marker': '已修复媒体库标记',
        'drive-scan': '检测到盘符变化并自动找到媒体库',
        manual: '媒体库绑定成功',
        missing: '原媒体目录不可用，请填写移动后的媒体目录',
        unconfigured: '尚未设置媒体目录',
      };
      return labels[source] || '媒体库状态已更新';
    },

    applyMediaLibraryStatus(status: MediaLibraryStatus | null): void {
      const app = useAppStore();
      app.mediaLibrary = status;
      if (!status) return;
      if (status.root_path) this.mediaPath = status.root_path;
      let detail = this.sourceText(status.source);
      if (status.rebound_paths > 0) detail += `，已重绑定 ${status.rebound_paths} 条路径`;
      this.libraryMessage = status.needs_binding ? { kind: 'err', text: detail } : null;
    },

    async initializeMediaLibrary(): Promise<MediaLibraryStatus> {
      try {
        const status = await invokeTauri<MediaLibraryStatus>('initialize_media_library');
        this.applyMediaLibraryStatus(status);
        return status;
      } catch (error) {
        const status: MediaLibraryStatus = { root_path: null, source: 'unconfigured', rebound_paths: 0, needs_binding: true };
        this.applyMediaLibraryStatus(status);
        this.libraryMessage = { kind: 'err', text: `媒体库初始化失败: ${errorText(error)}` };
        return status;
      }
    },

    async openSettingsPage(): Promise<void> {
      useNavigationStore().showPage('page-settings');
      await Promise.all([this.loadSummary(), this.loadEhSettings(), this.loadEhDashboard()]);
    },

    applyEhSettings(settings: EhSettings): void {
      if (settings.root_path) this.ehLibraryPath = displayWindowsPath(settings.root_path);
      this.ehMemberId = settings.ipb_member_id || '';
      this.ehPassHash = settings.ipb_pass_hash || '';
      this.ehIgneous = settings.igneous || '';
    },

    async loadEhSettings(): Promise<void> {
      try {
        this.applyEhSettings(await invokeTauri<EhSettings>('eh_get_settings'));
      } catch (error) {
        this.ehCredentialsMessage = { kind: 'err', text: `读取 Eh 设置失败：${errorText(error)}` };
      }
    },

    async loadEhDashboard(): Promise<void> {
      try {
        this.ehDashboard = await invokeTauri<EhLibraryDashboard>('eh_get_library_dashboard');
      } catch (error) {
        this.ehLibraryMessage = { kind: 'err', text: `读取 Eh 概览失败：${errorText(error)}` };
      }
    },

    async saveEhSettings(): Promise<void> {
      if (this.ehCredentialsSaving) return;
      const rootPath = this.ehLibraryPath.trim();
      if (!rootPath) {
        this.ehCredentialsMessage = { kind: 'err', text: '请先填写 Eh 库目录' };
        return;
      }
      this.ehCredentialsSaving = true;
      this.ehCredentialsMessage = { kind: 'info', text: '正在保存...' };
      try {
        const saved = await invokeTauri<EhSettings>('eh_save_settings', {
          input: {
            rootPath,
            ipbMemberId: this.ehMemberId.trim(),
            ipbPassHash: this.ehPassHash.trim(),
            igneous: this.ehIgneous.trim(),
          },
        });
        this.applyEhSettings(saved);
        this.ehCredentialsMessage = { kind: 'success', text: 'Eh 目录和访问凭据已保存' };
      } catch (error) {
        this.ehCredentialsMessage = { kind: 'err', text: `保存失败：${errorText(error)}` };
      } finally {
        this.ehCredentialsSaving = false;
      }
    },

    async bindMediaLibraryPath(path: string, showMessage: boolean): Promise<MediaLibraryStatus> {
      const status = await invokeTauri<MediaLibraryStatus>('bind_media_library', { rootPath: path });
      this.applyMediaLibraryStatus(status);
      if (showMessage && status.rebound_paths > 0) {
        this.libraryMessage = { kind: 'success', text: `媒体库已连接，已更新 ${status.rebound_paths} 条路径` };
      }
      return status;
    },

    async ensureMediaLibraryPath(path: string): Promise<MediaLibraryStatus | unknown> {
      const app = useAppStore();
      const current = (app.mediaLibrary as MediaLibraryStatus | null)?.root_path;
      if (!current || current.toLowerCase() !== path.toLowerCase()) return this.bindMediaLibraryPath(path, false);
      return app.mediaLibrary;
    },

    async bindMediaLibrary(): Promise<void> {
      const selected = await pickDirectory(this.mediaPath.trim());
      if (!selected) return;
      this.mediaPath = selected;
      const path = selected;
      if (!path) return;
      this.libraryMessage = { kind: 'info', text: '正在验证媒体库...' };
      try {
        await this.bindMediaLibraryPath(path, true);
        await useLibraryStore().reload({ resetFilters: false, clearCoverCache: true });
        this.scan = null;
        await this.loadSummary();
      } catch (error) {
        this.libraryMessage = { kind: 'err', text: `绑定失败: ${errorText(error)}` };
      }
    },

    async bindEhLibrary(): Promise<void> {
      const selected = await pickDirectory(this.ehLibraryPath.trim());
      if (!selected) return;
      this.ehLibraryPath = selected;
      const rootPath = selected;
      if (!rootPath) return;
      try {
        this.applyEhSettings(await invokeTauri<EhSettings>('eh_bind_local_library', { rootPath }));
        this.ehLibraryMessage = null;
        await useEhLibraryStore().load();
        await this.loadEhDashboard();
      } catch (error) {
        this.ehLibraryMessage = { kind: 'err', text: `连接失败：${errorText(error)}` };
      }
    },

    async scanEhLibrary(): Promise<void> {
      const rootPath = this.ehLibraryPath.trim();
      if (!rootPath || this.ehScanning) return;
      this.ehScanning = true;
      this.ehScanCompleted = false;
      this.ehScanErrors = [];
      this.ehProgressActive = true;
      this.ehProgressPercent = 0;
      this.ehProgressText = '正在准备扫描';
      let stopProgress: (() => void) | undefined;
      try {
        stopProgress = await listenTauri<EhScanProgressEvent>('eh-scan-progress', (progress) => {
          this.ehProgressActive = true;
          this.ehProgressPercent = Math.max(0, Math.min(100, progress.percent));
          this.ehProgressText = progress.text;
        });
        const result = await invokeTauri<EhScanResult>('eh_scan_local_library', { rootPath });
        await Promise.all([useEhLibraryStore().load(), this.loadEhDashboard()]);
        this.ehScanCompleted = true;
        this.ehScanErrors = result.errors;
        const detail = `扫描 ${result.folders} 部，索引 ${result.indexed} 部；新建 Meta ${result.created_meta} 个、封面 ${result.created_cover} 张`;
        this.ehLibraryMessage = result.errors.length
          ? { kind: 'err', text: `${detail}；${summarizeEhScanErrors(result.errors)}` }
          : { kind: 'success', text: detail };
        this.ehProgressPercent = 100;
        this.ehProgressText = '扫描完成';
        await new Promise((resolve) => window.setTimeout(resolve, 650));
      } catch (error) {
        this.ehLibraryMessage = { kind: 'err', text: `扫描失败：${errorText(error)}` };
      } finally {
        stopProgress?.();
        this.ehScanning = false;
        this.ehProgressActive = false;
        this.ehProgressPercent = 0;
        this.ehProgressText = '';
      }
    },

    async openEhScanIssue(index: number): Promise<void> {
      const issue = this.ehScanErrors[index];
      if (issue) await invokeTauri('open_folder', { path: issue.folder_path });
    },

    async backupEhDatabase(): Promise<void> {
      const backupPath = this.ehBackupPath.trim() || 'D:\\EhLibrary\\backup.db';
      try { await invokeTauri('eh_backup_database', { backupPath }); this.ehDataMessage = { kind: 'info', text: `备份成功: ${backupPath}` }; }
      catch (error) { this.ehDataMessage = { kind: 'err', text: `备份失败：${errorText(error)}` }; }
    },

    async backupEhDataPackage(): Promise<void> {
      const backupPath = this.ehBackupPath.trim() || 'D:\\EhLibrary\\eh-data-backup.zip';
      try { await invokeTauri('eh_backup_data_package', { backupPath }); this.ehDataMessage = { kind: 'info', text: `资料包备份成功: ${backupPath}` }; }
      catch (error) { this.ehDataMessage = { kind: 'err', text: `资料包备份失败：${errorText(error)}` }; }
    },

    async restoreEhDatabase(): Promise<void> {
      const restorePath = this.ehBackupPath.trim();
      if (!restorePath) return;
      try { await invokeTauri('eh_restore_database', { restorePath }); this.ehDataMessage = { kind: 'info', text: '恢复成功' }; await Promise.all([useEhLibraryStore().load(), this.loadEhDashboard()]); }
      catch (error) { this.ehDataMessage = { kind: 'err', text: `恢复失败：${errorText(error)}` }; }
    },

    async loadSummary(): Promise<void> {
      const path = this.mediaPath.trim();
      if (!path) return;
      try {
        this.summary = await invokeTauri<LibrarySummary>('get_library_console_summary', { rootPath: path });
      } catch (error) {
        this.libraryMessage = { kind: 'err', text: `统计失败：${errorText(error)}` };
      }
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
      if (item) await invokeTauri('open_folder', { path: item.folder_path });
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
        await invokeTauri('delete_work', { workId: item.work_id });
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
        this.scan = await invokeTauri<LibraryScan>('scan_library_changes', { rootPath: path });
        this.summary = this.scan.summary;
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
        await invokeTauri('apply_library_updates', { folders: items.map((item) => item.folder_path) });
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
        await invokeTauri('batch_import_folders', { folders: items.map((item) => item.folder_path) });
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
        this.duplicates = await invokeTauri<DuplicateGroup[]>('detect_duplicates', { rootPath: path });
        this.duplicateMessage = { kind: this.duplicates.length ? 'err' : 'info', text: this.duplicates.length ? `发现 ${this.duplicates.length} 组疑似重复` : '未发现重复作品' };
      } catch (error) {
        this.duplicateMessage = { kind: 'err', text: `查重失败: ${errorText(error)}` };
      }
    },

    async backupDatabase(): Promise<void> {
      const path = this.backupPath.trim() || 'D:\\HAnime\\backup.db';
      try {
        await invokeTauri('backup_database', { backupPath: path });
        this.databaseMessage = { kind: 'info', text: `备份成功: ${path}` };
      } catch (error) {
        this.databaseMessage = { kind: 'err', text: `备份失败: ${errorText(error)}` };
      }
    },

    async backupDataPackage(): Promise<void> {
      if (this.busy) return;
      const path = this.backupPath.trim() || 'D:\\Ark\\hanime-data-backup.zip';
      this.backupRunning = true;
      this.databaseMessage = null;
      this.setProgress(true, 1, '正在准备资料包备份');
      let stopProgress: (() => void) | undefined;
      try {
        stopProgress = await listenTauri<BackupProgressEvent>('backup-data-package-progress', (progress) => {
          this.setProgress(true, progress.percent, progress.text);
        });
        const result = await invokeTauri<string>('backup_data_package', { backupPath: path });
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
        await invokeTauri('restore_database', { restorePath: path });
        this.databaseMessage = { kind: 'info', text: '恢复成功，请重启应用' };
      } catch (error) {
        this.databaseMessage = { kind: 'err', text: `恢复失败: ${errorText(error)}` };
      }
    },
  },
});
