import { defineStore } from 'pinia';
import { ehApi } from '../api/commands/eh';
import type { EhDownloadFailure, EhDownloadProgressEvent, EhDownloadResult } from '../api/contracts/eh';
import type { UiMessage } from '../api/contracts/settings';
import { useEhLibraryStore } from './ehLibrary';
import { useEhSettingsStore } from './ehSettings';
import { useNavigationStore } from './navigation';

export type DownloadSource = 'eh' | 'hitomi';
export interface EhDownloadHistory {
  gid: number;
  source: DownloadSource;
  title: string;
  folderPath: string;
  coverPath: string;
  totalPages: number;
  downloadedPages: number;
  failedPages: number[];
  failures: EhDownloadFailure[];
  queuedAt: string;
  completedAt: string;
  error?: string;
}
export interface DownloadQueueItem {
  key: string;
  source: DownloadSource;
  id: number;
  title: string;
  status: 'queued' | 'downloading';
  progressPercent: number;
  progressText: string;
  totalPages: number;
  downloadedPages: number;
  coverPath: string;
  queuedAt: string;
  pageIndices?: number[];
}

export type DownloadCard = {
  key: string;
  source: DownloadSource;
  gid: number;
  queuedAt: string;
} & ({ kind: 'queue'; job: DownloadQueueItem } | { kind: 'history'; item: EhDownloadHistory });

export function isDownloadComplete(item: EhDownloadHistory): boolean {
  return !item.error && !item.failedPages.length && item.totalPages > 0
    && item.downloadedPages === item.totalPages;
}

const HISTORY_KEY = 'eh-download-history';
const HISTORY_LIMIT_PER_SOURCE = 20;
// Credentials are needed only by pending/retry jobs in this process. Never
// serialize them with the gallery history or expose them in card state.
// Pinia binds actions to different proxy objects; keying credentials by `this`
// can lose a token between enqueue and worker execution. This module-local
// vault exists only for the current process and is never persisted or exposed
// in queue/history state.
const tokenVault = new Map<string, string>();
const workKey = (source: DownloadSource, id: number): string => `${source}:${id}`;
const sourceForGid = (gid: number): DownloadSource => gid < 0 ? 'hitomi' : 'eh';
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const validPage = (page: unknown, total: number): page is number =>
  Number.isInteger(page) && (page as number) > 0 && (page as number) <= total;

function normalizeHistoryItem(item: unknown): EhDownloadHistory | null {
  if (!item || typeof item !== 'object') return null;
  const entry = item as Record<string, unknown>;
  const gid = entry.gid;
  const totalPages = entry.totalPages;
  const downloadedPages = entry.downloadedPages;
  if (!Number.isSafeInteger(gid) || gid === 0 || typeof entry.title !== 'string'
    || typeof entry.folderPath !== 'string' || !Number.isInteger(totalPages) || (totalPages as number) < 0
    || !Number.isInteger(downloadedPages) || typeof entry.completedAt !== 'string') return null;
  if ((downloadedPages as number) < 0 || (downloadedPages as number) > (totalPages as number)
    || Number.isNaN(Date.parse(entry.completedAt))) return null;
  if (!Array.isArray(entry.failedPages) || !entry.failedPages.every((page) => validPage(page, totalPages as number))) return null;
  const byPage = new Map<number, EhDownloadFailure>();
  for (const page of entry.failedPages) byPage.set(page, { page, reason: '下载失败' });
  if (Array.isArray(entry.failures)) {
    for (const failure of entry.failures) {
      if (!failure || typeof failure !== 'object') continue;
      const value = failure as Record<string, unknown>;
      if (validPage(value.page, totalPages as number) && typeof value.reason === 'string') {
        byPage.set(value.page, { page: value.page, reason: value.reason });
      }
    }
  }
  const failures = [...byPage.values()].sort((a, b) => a.page - b.page);
  return {
    gid: gid as number, source: sourceForGid(gid as number), title: entry.title,
    folderPath: entry.folderPath, coverPath: typeof entry.coverPath === 'string' ? entry.coverPath : '',
    totalPages: totalPages as number, downloadedPages: downloadedPages as number,
    failedPages: failures.map((failure) => failure.page), failures, completedAt: entry.completedAt,
    queuedAt: typeof entry.queuedAt === 'string' && Number.isFinite(Date.parse(entry.queuedAt))
      ? entry.queuedAt : entry.completedAt,
    error: typeof entry.error === 'string' ? entry.error : undefined,
  };
}
function limitHistory(entries: EhDownloadHistory[]): EhDownloadHistory[] {
  const counts = { eh: 0, hitomi: 0 };
  return entries.filter((entry) => ++counts[entry.source] <= HISTORY_LIMIT_PER_SOURCE);
}
function readHistory(): EhDownloadHistory[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(value)
      ? limitHistory(value.flatMap((item) => { const entry = normalizeHistoryItem(item); return entry ? [entry] : []; }))
      : [];
  } catch { return []; }
}
function positiveId(value: string): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export const useEhDownloadStore = defineStore('ehDownload', {
  state: () => ({
    ehGidInput: '', ehTokenInput: '', hitomiIdInput: '',
    messages: { eh: null as UiMessage | null, hitomi: null as UiMessage | null },
    queue: [] as DownloadQueueItem[],
    workerRunning: false,
    history: readHistory(),
  }),
  getters: {
    downloading: (state): boolean => state.workerRunning,
    ehQueue: (state): DownloadQueueItem[] => state.queue.filter((item) => item.source === 'eh'),
    hitomiQueue: (state): DownloadQueueItem[] => state.queue.filter((item) => item.source === 'hitomi'),
    ehHistory: (state): EhDownloadHistory[] => state.history.filter((item) => item.source === 'eh'),
    hitomiHistory: (state): EhDownloadHistory[] => state.history.filter((item) => item.source === 'hitomi'),
    cards: (state): DownloadCard[] => {
      const queuedKeys = new Set(state.queue.map((job) => job.key));
      const cards: DownloadCard[] = state.history
        .filter((item) => !queuedKeys.has(workKey(item.source, Math.abs(item.gid))))
        .map((item) => ({ kind: 'history', key: workKey(item.source, Math.abs(item.gid)),
          source: item.source, gid: item.gid, queuedAt: item.queuedAt, item }));
      cards.push(...state.queue.map((job): DownloadCard => ({ kind: 'queue', key: job.key,
        source: job.source, gid: job.source === 'eh' ? job.id : -job.id, queuedAt: job.queuedAt, job })));
      // 卡片按堆栈显示：新加入的在最前，旧的往后；状态变化和重试不换位，下载仍按 FIFO 执行。
      return cards.sort((left, right) => Date.parse(right.queuedAt) - Date.parse(left.queuedAt)
        || left.key.localeCompare(right.key));
    },
  },
  actions: {
    persistHistory(): void {
      if (typeof window === 'undefined') return;
      try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history)); } catch { /* auxiliary only */ }
    },
    upsertHistory(entry: EhDownloadHistory): void {
      this.history = limitHistory([entry, ...this.history.filter((item) => item.gid !== entry.gid)]);
      this.persistHistory();
    },
    clearInputs(source: DownloadSource): void {
      if (source === 'eh') { this.ehGidInput = ''; this.ehTokenInput = ''; }
      else this.hitomiIdInput = '';
      this.messages[source] = null;
    },
    nextQueuedAt(): string {
      const latest = Math.max(0, ...this.history.map((item) => Date.parse(item.queuedAt)),
        ...this.queue.map((job) => Date.parse(job.queuedAt)));
      // 同毫秒连续加入或系统时钟回拨时，新作品也必须排在已有卡片之前。
      return new Date(Math.max(Date.now(), latest + 1)).toISOString();
    },
    enqueue(source: DownloadSource, id: number, token = '', pageIndices?: number[]): boolean {
      if (!Number.isSafeInteger(id) || id <= 0 || (source === 'eh' && !token.trim())) return false;
      const key = workKey(source, id);
      if (this.queue.some((item) => item.key === key)) {
        this.messages[source] = { kind: 'info', text: '该作品已在下载队列中' };
        return false;
      }
      if (source === 'eh') tokenVault.set(key, token);
      const previous = this.history.find((item) => item.gid === (source === 'eh' ? id : -id));
      const selected = pageIndices?.length ? [...new Set(pageIndices)].sort((a, b) => a - b) : undefined;
      const progress = selected && previous?.totalPages
        ? Math.floor(previous.downloadedPages / previous.totalPages * 100) : 0;
      this.queue.push({
        key, source, id, title: previous?.title || `${source === 'eh' ? 'Eh' : 'Hitomi'} · ${id}`,
        status: 'queued', progressPercent: progress, progressText: '等待下载',
        totalPages: previous?.totalPages || 0, downloadedPages: previous?.downloadedPages || 0,
        coverPath: previous?.coverPath || '', pageIndices: selected,
        queuedAt: previous?.queuedAt || this.nextQueuedAt(),
      });
      this.messages[source] = { kind: 'success', text: `已将 ${id} 加入队列` };
      void this.processQueue();
      return true;
    },
    enqueueEh(): void {
      const id = positiveId(this.ehGidInput);
      const token = this.ehTokenInput.trim();
      if (!id) { this.messages.eh = { kind: 'err', text: '请输入有效的 GID' }; return; }
      if (!token) { this.messages.eh = { kind: 'err', text: '请输入 Token' }; return; }
      if (this.enqueue('eh', id, token)) {
        this.ehGidInput = ''; this.ehTokenInput = '';
      }
    },
    enqueueHitomi(): void {
      const id = positiveId(this.hitomiIdInput);
      if (!id) { this.messages.hitomi = { kind: 'err', text: '请输入有效的 Hitomi ID' }; return; }
      if (this.enqueue('hitomi', id)) this.hitomiIdInput = '';
    },
    async openCompletedGallery(gid: number): Promise<void> {
      const item = this.history.find((entry) => entry.gid === gid);
      if (!item || !isDownloadComplete(item)
        || this.queue.some((job) => job.key === workKey(item.source, Math.abs(gid)))) return;
      const library = useEhLibraryStore();
      // 保留带符号的内部 GID，避免 Eh 与 Hitomi 同号作品跳错；历史不充当作品详情。
      let gallery = library.galleries.find((entry) => entry.gid === gid);
      if (!gallery) {
        await library.load();
        gallery = library.galleries.find((entry) => entry.gid === gid);
      }
      if (gallery) library.showDetail(gallery);
      else this.messages[item.source] = {
        kind: 'err', text: library.error || '当前 本子库中找不到该作品，请确认库目录和入库记录',
      };
    },
    retryHistoryPages(item: EhDownloadHistory, pages: number[] = item.failedPages): void {
      const current = this.history.find((entry) => entry.gid === item.gid);
      if (!current) return;
      const allowed = new Set(current.failedPages);
      const selected = [...new Set(pages.filter((page) => allowed.has(page)))];
      if (!selected.length && !current.error) return;
      const id = Math.abs(current.gid);
      if (current.source === 'hitomi') {
        this.enqueue('hitomi', id, '', selected.length ? selected : undefined);
        return;
      }
      const key = workKey('eh', id);
      const typedToken = positiveId(this.ehGidInput) === id ? this.ehTokenInput.trim() : '';
      const token = typedToken || tokenVault.get(key) || '';
      if (!token) {
        this.ehGidInput = String(id);
        this.ehTokenInput = '';
        this.messages.eh = { kind: 'err', text: `请先输入 ${id} 的 Token，再点击重试失败页` };
        return;
      }
      if (this.enqueue('eh', id, token, selected.length ? selected : undefined)) {
        if (typedToken) { this.ehGidInput = ''; this.ehTokenInput = ''; }
      }
    },
    removeQueued(key: string): void {
      const item = this.queue.find((entry) => entry.key === key && entry.status === 'queued');
      if (!item) return;
      this.queue = this.queue.filter((entry) => entry.key !== key);
      tokenVault.delete(key);
    },
    rememberResult(result: EhDownloadResult, job: DownloadQueueItem): EhDownloadHistory {
      const previous = this.history.find((item) => item.gid === result.gid);
      const requested = new Set(job.pageIndices || []);
      const failures = job.pageIndices?.length
        ? [...(previous?.failures || []).filter((failure) => !requested.has(failure.page)), ...result.failures]
        : result.failures;
      const unique = [...new Map(failures.map((failure) => [failure.page, failure])).values()].sort((a, b) => a.page - b.page);
      const downloadedPages = job.source === 'hitomi' || !job.pageIndices?.length
        ? result.downloaded_pages
        : previous && previous.totalPages === result.total_pages
          ? Math.min(result.total_pages, previous.downloadedPages + result.downloaded_pages)
          : result.downloaded_pages;
      const entry: EhDownloadHistory = {
        gid: result.gid, source: job.source, title: result.title, folderPath: result.folder_path,
        coverPath: result.cover_path || previous?.coverPath || '', totalPages: result.total_pages,
        downloadedPages, failedPages: unique.map((failure) => failure.page), failures: unique,
        queuedAt: job.queuedAt, completedAt: new Date().toISOString(),
        error: !result.meta_path && !unique.length ? '作品尚未完整入库，可重新尝试' : undefined,
      };
      this.upsertHistory(entry);
      return entry;
    },
    rememberError(job: DownloadQueueItem, error: unknown): EhDownloadHistory {
      const gid = job.source === 'eh' ? job.id : -job.id;
      const previous = this.history.find((item) => item.gid === gid);
      const entry: EhDownloadHistory = {
        gid, source: job.source, title: previous?.title || job.title,
        folderPath: previous?.folderPath || '', coverPath: previous?.coverPath || '',
        totalPages: previous?.totalPages || 0, downloadedPages: previous?.downloadedPages || 0,
        failedPages: previous?.failedPages || [], failures: previous?.failures || [],
        queuedAt: job.queuedAt, completedAt: new Date().toISOString(), error: errorText(error),
      };
      this.upsertHistory(entry);
      return entry;
    },
    async refreshLibrary(): Promise<void> {
      const library = useEhLibraryStore();
      library.currentSort = 'added-desc';
      library.currentPage = 1;
      try { await Promise.all([library.load(), useEhSettingsStore().loadDashboard()]); }
      catch { /* library can refresh again after the next navigation */ }
    },
    async processQueue(): Promise<void> {
      if (this.workerRunning) return;
      this.workerRunning = true;
      try {
        let job: DownloadQueueItem | undefined;
        while ((job = this.queue.find((item) => item.status === 'queued'))) {
          job.status = 'downloading';
          job.progressText = '正在获取作品信息';
          let stopProgress: (() => void) | undefined;
          try {
            const active = job;
            const listen = active.source === 'eh' ? ehApi.listenDownloadProgress : ehApi.listenHitomiProgress;
            stopProgress = await listen((event: EhDownloadProgressEvent) => {
              if (Math.abs(event.gid) !== active.id) return;
              active.progressText = event.text;
              active.progressPercent = active.pageIndices?.length && active.totalPages
                ? Math.min(100, Math.round((active.downloadedPages + event.page) / active.totalPages * 100))
                : Math.max(0, Math.min(100, event.percent));
            });
            const result = active.source === 'eh'
              ? await ehApi.downloadGallery({
                gid: active.id, token: tokenVault.get(active.key) || '', pageIndices: active.pageIndices,
              })
              : await ehApi.downloadHitomi({ id: active.id, pageIndices: active.pageIndices });
            const entry = this.rememberResult(result, active);
            if (entry.failedPages.length || entry.error) {
              this.messages[active.source] = { kind: 'err', text: `${active.id} 尚未完成，可从下方卡片重试` };
            } else {
              tokenVault.delete(active.key);
              this.messages[active.source] = { kind: 'success', text: `${active.id} 下载完成，已入库` };
            }
            if (result.meta_path) void this.refreshLibrary();
          } catch (error) {
            this.rememberError(job, error);
            this.messages[job.source] = { kind: 'err', text: `${job.id} 下载失败，可从作品卡片重试` };
          } finally {
            try { stopProgress?.(); } catch { /* best-effort event cleanup */ }
            this.queue = this.queue.filter((item) => item.key !== job?.key);
          }
        }
      } finally { this.workerRunning = false; }
    },
    async forgetHistory(gid: number): Promise<void> {
      const item = this.history.find((entry) => entry.gid === gid);
      if (!item) return;
      const confirmed = await useNavigationStore().askConfirm(
        '移除下载记录', `确定移除“${item.title}”的下载记录？不会删除本地文件。`, '移除记录',
      );
      if (!confirmed) return;
      this.history = this.history.filter((entry) => entry.gid !== gid);
      tokenVault.delete(workKey(item.source, Math.abs(gid)));
      this.persistHistory();
    },
    async deleteHistory(gid: number, deleteFolder: boolean): Promise<void> {
      const item = this.history.find((entry) => entry.gid === gid);
      if (!item) return;
      if (this.queue.some((job) => job.key === workKey(item.source, Math.abs(gid)))) {
        this.messages[item.source] = { kind: 'err', text: '该作品仍在队列中，请等待下载结束或先移出队列' };
        return;
      }
      if (!item.folderPath) { await this.forgetHistory(gid); return; }
      const confirmed = await useNavigationStore().askConfirm(
        deleteFolder ? '删除本地作品' : '移除数据库记录',
        deleteFolder ? `确定永久删除“${item.title}”的整个本地文件夹？其中所有图片和 data 资料都会被删除，无法撤销。`
          : `确定仅从 本子数据库移除“${item.title}”？本地文件夹及图片不会被删除。`,
        deleteFolder ? '删除文件夹' : '移除记录', true,
      );
      if (!confirmed) return;
      try {
        if (deleteFolder && item.source === 'hitomi') await ehApi.deleteHitomiFolder(-gid);
        else if (deleteFolder) await ehApi.deleteFolder(gid);
        else await ehApi.deleteRecord(gid);
        this.history = this.history.filter((entry) => entry.gid !== gid);
        tokenVault.delete(workKey(item.source, Math.abs(gid)));
        this.persistHistory();
        this.messages[item.source] = { kind: 'success', text: deleteFolder ? '本地文件和记录已删除' : '数据库记录已移除，本地文件未删除' };
        await this.refreshLibrary();
      } catch (error) {
        this.messages[item.source] = { kind: 'err', text: `删除失败：${errorText(error)}` };
      }
    },
  },
});
