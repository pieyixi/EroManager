import { defineStore } from 'pinia';
import { accountScope } from '../api/accountContext';
import { avApi } from '../api/commands/av';
import { useAvLibraryStore } from './avLibrary';
import type { AvWork } from '../api/contracts/av';

export interface AvFetchJob { code: string; status: 'queued' | 'fetching' | 'complete' | 'failed'; error: string; warnings: string[]; work: AvWork | null; admitted: number }
const missingDirectory = '请先在设置的「数据」中配置 AV 资料目录';
export const useAvDownloadStore = defineStore('avDownload', {
  state: () => ({ input: '', root: '', error: '', initialized: false, initializing: false, running: false, binding: false,
    directoryLoading: false, directoryRevision: 0, directoryMessage: '', directoryFailed: false, jobs: [] as AvFetchJob[] }),
  getters: {
    activeCount: state => state.jobs.filter(job => job.status === 'fetching').length,
    waitingCount: state => state.jobs.filter(job => job.status === 'queued').length,
    cards: state => {
      let history = 0;
      // 与现有下载页保持同一记录上限；等待/正在获取的任务不被历史截断。
      return [...state.jobs].sort((a, b) => b.admitted - a.admitted).filter(job => ['queued', 'fetching'].includes(job.status) || history++ < 20);
    },
  },
  actions: {
    async loadSettings(): Promise<boolean> {
      if (this.binding) return false;
      const owner = accountScope(); if (!owner) return false;
      const revision = ++this.directoryRevision; this.directoryLoading = true;
      try {
        const settings = await avApi.settings();
        if (owner !== accountScope() || revision !== this.directoryRevision) return false;
        this.root = settings.root_path; if (this.root && this.error === missingDirectory) this.error = ''; return true;
      } catch (error) {
        if (owner === accountScope() && revision === this.directoryRevision) { this.directoryMessage = String(error); this.directoryFailed = true; }
        return false;
      } finally { if (revision === this.directoryRevision) this.directoryLoading = false; }
    },
    async initialize(): Promise<void> {
      if (this.initializing) return;
      const owner = accountScope(); if (!owner) return;
      this.initializing = true;
      try {
        if (!await this.loadSettings() || owner !== accountScope()) return;
        this.initialized = true;
        const library = useAvLibraryStore(); if (!library.loaded) await library.load();
        if (owner !== accountScope()) return;
        for (const work of library.works.filter(work => !!work.source_url).sort((a,b) => b.queued_at.localeCompare(a.queued_at)).slice(0,20)) if (!this.jobs.some(job => job.code === work.code)) {
          this.jobs.push({ code: work.code, status: 'complete', work, error: '', warnings: work.previews.some(path => !path) ? ['部分预览图尚未取得，请重试获取'] : [], admitted: Date.parse(work.queued_at) || 0 });
        }
        void this.pump();
      } catch (error) { if (owner === accountScope()) this.error = String(error); }
      finally { this.initializing = false; }
    },
    async bindRoot(root: string): Promise<void> {
      if (this.binding || this.running) return;
      const owner = accountScope(), revision = ++this.directoryRevision;
      this.binding = true; this.directoryLoading = false; this.directoryMessage = ''; this.directoryFailed = false;
      try {
        const settings = await avApi.bindRoot(root);
        if (owner === accountScope() && revision === this.directoryRevision) {
          this.root = settings.root_path; this.directoryMessage = '目录已更新'; if (this.root && this.error === missingDirectory) this.error = '';
          const library=useAvLibraryStore(); library.imageRevision++; library.coverCache={}; library.loaded=false; await library.load();
        }
      }
      catch (error) { if (owner === accountScope() && revision === this.directoryRevision) { this.directoryMessage = String(error); this.directoryFailed = true; } }
      finally { this.binding = false; }
    },
    clearInputs(): void { this.input = ''; this.error = ''; },
    enqueue(): void {
      if (this.binding || this.initializing) { this.error = '资料目录正在准备，请稍候'; return; }
      const code = this.input.trim().toUpperCase().replace(/^([A-Z]{2,12})(\d{2,9})$/, '$1-$2');
      if (!/^(?:[A-Z][A-Z0-9]{1,15}-\d{2,9}|FC2-PPV-\d{3,10})$/.test(code)) { this.error = '请输入有效番号，例如 IPX-607'; return; }
      if (!this.root) { this.error = missingDirectory; return; }
      this.error = '';
      const job = this.jobs.find(item => item.code === code);
      if (job?.status === 'queued' || job?.status === 'fetching') { this.error = '这个番号已经在队列中'; return; }
      if (job) { job.status = 'queued'; job.error = ''; job.warnings = []; }
      else this.jobs.push({ code, status: 'queued', work: null, error: '', warnings: [], admitted: Math.max(Date.now(), ...this.jobs.map(job => job.admitted + 1)) });
      this.input = ''; void this.pump();
    },
    retry(code: string): void { const job = this.jobs.find(item => item.code === code); if (job && !['fetching', 'queued'].includes(job.status)) { job.status = 'queued'; job.error = ''; void this.pump(); } },
    removeQueued(code: string): void { this.jobs = this.jobs.filter(job => job.code !== code || job.status !== 'queued'); },
    async pump(): Promise<void> {
      if (this.running || !accountScope()) return;
      this.running = true;
      try {
        let job: AvFetchJob | undefined;
        while (accountScope() && (job = this.jobs.find(item => item.status === 'queued'))) {
          const active = job, owner = accountScope(); active.status = 'fetching';
          try {
            const result = await avApi.fetchWork(active.code, owner, active.admitted);
            active.work = result.work; active.warnings = result.warnings; active.status = 'complete';
            if (owner === accountScope()) useAvLibraryStore().upsert(result.work);
            else if (accountScope()) await useAvLibraryStore().load();
          } catch (error) { active.error = String(error); active.status = 'failed'; }
        }
      } finally { this.running = false; }
    },
  },
});
