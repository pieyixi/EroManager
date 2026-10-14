import { defineStore } from 'pinia';
import { pickDirectory } from '../api/tauri';
import { settingsApi } from '../api/commands/settings';
import { systemApi } from '../api/commands/system';
import type { EhLibraryDashboard, EhScanIssue, EhScanProgressEvent, EhScanResult, EhSettings, UiMessage } from '../api/contracts/settings';
import { useEhLibraryStore } from './ehLibrary';

export type { EhCategoryMetric, EhLibraryDashboard, EhScanIssue, EhScanResult, EhSettings } from '../api/contracts/settings';

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function displayWindowsPath(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) return `\\\\${path.slice(8)}`;
  return path.startsWith('\\\\?\\') ? path.slice(4) : path;
}
function summarizeScanErrors(errors: EhScanIssue[]): string {
  if (!errors.length) return '';
  const missingSource = errors.filter((error) => error.reason.includes('.ehviewer')).length;
  const missingCover = errors.filter((error) => error.reason.includes('无法建立封面')).length;
  const other = errors.length - missingSource - missingCover;
  return `失败 ${errors.length} 部（${[
    missingSource ? `缺少来源信息 ${missingSource}` : '',
    missingCover ? `缺少封面来源 ${missingCover}` : '',
    other ? `其他错误 ${other}` : '',
  ].filter(Boolean).join('，')}）`;
}

export const useEhSettingsStore = defineStore('ehSettings', {
  state: () => ({
    ehLibraryPath: '', ehMemberId: '', ehPassHash: '', ehIgneous: '',
    ehCredentialsSaving: false, ehCredentialsMessage: null as UiMessage | null,
    ehLibraryMessage: null as UiMessage | null, ehScanning: false, ehScanCompleted: false,
    ehScanErrors: [] as EhScanIssue[], ehProgressActive: false, ehProgressPercent: 0, ehProgressText: '',
    ehDashboard: { total_count: 0, total_pages: 0, total_bytes: 0, categories: [] } as EhLibraryDashboard,
  }),
  getters: { connected: (state) => Boolean(state.ehLibraryPath.trim()) },
  actions: {
    applySettings(settings: EhSettings): void {
      if (settings.root_path) this.ehLibraryPath = displayWindowsPath(settings.root_path);
      this.ehMemberId = settings.ipb_member_id || '';
      this.ehPassHash = settings.ipb_pass_hash || '';
      this.ehIgneous = settings.igneous || '';
    },
    async loadSettings(): Promise<void> {
      try { this.applySettings(await settingsApi.getEhSettings()); }
      catch (error) { this.ehCredentialsMessage = { kind: 'err', text: `读取 Eh 设置失败：${errorText(error)}` }; }
    },
    async loadDashboard(): Promise<void> {
      try { this.ehDashboard = await settingsApi.getEhDashboard(); }
      catch (error) { this.ehLibraryMessage = { kind: 'err', text: `读取 Eh 概览失败：${errorText(error)}` }; }
    },
    async saveSettings(): Promise<void> {
      if (this.ehCredentialsSaving) return;
      const rootPath = this.ehLibraryPath.trim();
      if (!rootPath) { this.ehCredentialsMessage = { kind: 'err', text: '请先填写 本子库目录' }; return; }
      this.ehCredentialsSaving = true;
      this.ehCredentialsMessage = { kind: 'info', text: '正在保存...' };
      try {
        const saved = await settingsApi.saveEhSettings({ rootPath, ipbMemberId: this.ehMemberId.trim(), ipbPassHash: this.ehPassHash.trim(), igneous: this.ehIgneous.trim() });
        this.applySettings(saved);
        this.ehCredentialsMessage = { kind: 'success', text: 'Eh 目录和访问凭据已保存' };
      } catch (error) { this.ehCredentialsMessage = { kind: 'err', text: `保存失败：${errorText(error)}` }; }
      finally { this.ehCredentialsSaving = false; }
    },
    async bindLibrary(): Promise<void> {
      const selected = await pickDirectory(this.ehLibraryPath.trim());
      if (!selected) return;
      this.ehLibraryPath = selected;
      try {
        this.applySettings(await settingsApi.bindEhLibrary(selected));
        this.ehLibraryMessage = null;
        await useEhLibraryStore().load();
        await this.loadDashboard();
      } catch (error) { this.ehLibraryMessage = { kind: 'err', text: `连接失败：${errorText(error)}` }; }
    },
    async scanLibrary(): Promise<void> {
      const rootPath = this.ehLibraryPath.trim();
      if (!rootPath || this.ehScanning) return;
      this.ehScanning = true; this.ehScanCompleted = false; this.ehScanErrors = [];
      this.ehProgressActive = true; this.ehProgressPercent = 0; this.ehProgressText = '正在准备扫描';
      let stopProgress: (() => void) | undefined;
      try {
        stopProgress = await settingsApi.listenEhProgress((progress: EhScanProgressEvent) => {
          this.ehProgressActive = true;
          this.ehProgressPercent = Math.max(0, Math.min(100, progress.percent));
          this.ehProgressText = progress.text;
        });
        const result: EhScanResult = await settingsApi.scanEhLibrary(rootPath);
        await Promise.all([useEhLibraryStore().load(), this.loadDashboard()]);
        this.ehScanCompleted = true; this.ehScanErrors = result.errors;
        const detail = `扫描 ${result.folders} 部，索引 ${result.indexed} 部；新建 Meta ${result.created_meta} 个、封面 ${result.created_cover} 张`;
        this.ehLibraryMessage = result.errors.length ? { kind: 'err', text: `${detail}；${summarizeScanErrors(result.errors)}` } : { kind: 'success', text: detail };
        this.ehProgressPercent = 100; this.ehProgressText = '扫描完成';
        await new Promise((resolve) => window.setTimeout(resolve, 650));
      } catch (error) { this.ehLibraryMessage = { kind: 'err', text: `扫描失败：${errorText(error)}` }; }
      finally {
        stopProgress?.(); this.ehScanning = false; this.ehProgressActive = false;
        this.ehProgressPercent = 0; this.ehProgressText = '';
      }
    },
    async openScanIssue(index: number): Promise<void> {
      const issue = this.ehScanErrors[index];
      if (issue) await systemApi.openFolder(issue.folder_path);
    },
  },
});
