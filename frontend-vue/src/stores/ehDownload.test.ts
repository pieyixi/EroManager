import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EhDownloadResult } from '../api/contracts/eh';
import type { EhDownloadHistory } from './ehDownload';

const mocks = vi.hoisted(() => ({
  downloadGallery: vi.fn(),
  downloadHitomi: vi.fn(),
  listenDownloadProgress: vi.fn().mockResolvedValue(() => undefined),
  listenHitomiProgress: vi.fn().mockResolvedValue(() => undefined),
  deleteRecord: vi.fn().mockResolvedValue(undefined),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
  deleteHitomiFolder: vi.fn().mockResolvedValue(undefined),
  getEhDashboard: vi.fn().mockResolvedValue({ total_count: 0, total_pages: 0, total_bytes: 0, categories: [] }),
  askConfirm: vi.fn().mockResolvedValue(true),
}));
vi.mock('../api/commands/eh', () => ({ ehApi: mocks }));
vi.mock('../api/commands/settings', () => ({ settingsApi: mocks }));
vi.mock('../api/commands/system', () => ({ systemApi: { openFolder: vi.fn() } }));
vi.mock('../api/tauri', () => ({ pickDirectory: vi.fn() }));
vi.mock('./ehLibrary', () => ({ useEhLibraryStore: () => ({ load: vi.fn().mockResolvedValue(undefined), currentSort: '', currentPage: 1 }) }));
vi.mock('./navigation', () => ({ useNavigationStore: () => ({ askConfirm: mocks.askConfirm }) }));

import { useEhDownloadStore } from './ehDownload';

const ehResult = (id: number, downloaded = 3, failures: EhDownloadResult['failures'] = []): EhDownloadResult => ({
  gid: id, title: `Eh ${id}`, folder_path: `D:\\Eh\\${id}`, total_pages: 3,
  downloaded_pages: downloaded, failures, meta_path: `D:\\Eh\\${id}\\data\\meta.json`,
  cover_path: `D:\\Eh\\${id}\\data\\cover.jpg`,
});
const hitomiResult = (id: number, downloaded = 3, failures: EhDownloadResult['failures'] = []): EhDownloadResult => ({
  gid: -id, title: `Hitomi ${id}`, folder_path: `D:\\Eh\\hitomi-${id}`, total_pages: 3,
  downloaded_pages: downloaded, failures, meta_path: failures.length ? '' : `D:\\Eh\\hitomi-${id}\\data\\meta.json`,
  cover_path: failures.length ? '' : `D:\\Eh\\hitomi-${id}\\data\\cover.webp`,
});
const historyItem = (gid: number, failures: EhDownloadHistory['failures'] = []): EhDownloadHistory => ({
  gid, source: gid < 0 ? 'hitomi' : 'eh', title: `Work ${Math.abs(gid)}`,
  folderPath: `D:\\Eh\\${Math.abs(gid)}`, coverPath: '', totalPages: 3,
  downloadedPages: 3 - failures.length, failedPages: failures.map((failure) => failure.page),
  failures, completedAt: '2026-10-11T00:00:00.000Z',
});
async function idle(store: ReturnType<typeof useEhDownloadStore>): Promise<void> {
  await vi.waitFor(() => { expect(store.workerRunning).toBe(false); expect(store.queue).toHaveLength(0); });
}

describe('Eh and Hitomi download queue', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    setActivePinia(createPinia());
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.listenDownloadProgress.mockResolvedValue(() => undefined);
    mocks.listenHitomiProgress.mockResolvedValue(() => undefined);
    mocks.deleteRecord.mockResolvedValue(undefined);
    mocks.deleteFolder.mockResolvedValue(undefined);
    mocks.deleteHitomiFolder.mockResolvedValue(undefined);
    mocks.getEhDashboard.mockResolvedValue({ total_count: 0, total_pages: 0, total_bytes: 0, categories: [] });
    mocks.askConfirm.mockResolvedValue(true);
  });

  it('validates each lane independently and clears only that lane input', () => {
    const store = useEhDownloadStore();
    store.enqueueEh();
    expect(store.messages.eh?.text).toBe('请输入有效的 GID');
    store.ehGidInput = '123';
    store.enqueueEh();
    expect(store.messages.eh?.text).toBe('请输入 Token');
    store.hitomiIdInput = '456';
    store.clearInputs('eh');
    expect([store.ehGidInput, store.ehTokenInput, store.hitomiIdInput]).toEqual(['', '', '456']);
    expect(store.messages.eh).toBeNull();
    expect(mocks.downloadGallery).not.toHaveBeenCalled();
  });

  it('accepts another work while one runs, then processes both sources in FIFO order', async () => {
    let resolveEh!: (result: EhDownloadResult) => void;
    mocks.downloadGallery.mockImplementationOnce(() => new Promise((resolve) => { resolveEh = resolve; }));
    mocks.downloadHitomi.mockResolvedValueOnce(hitomiResult(202));
    const store = useEhDownloadStore();
    store.ehGidInput = '101'; store.ehTokenInput = 'secret-101';
    store.enqueueEh();
    await vi.waitFor(() => expect(mocks.downloadGallery).toHaveBeenCalledTimes(1));
    store.hitomiIdInput = '202';
    store.enqueueHitomi();
    expect(store.queue.map((job) => [job.source, job.status])).toEqual([['eh', 'downloading'], ['hitomi', 'queued']]);
    expect(mocks.downloadHitomi).not.toHaveBeenCalled();
    expect(JSON.stringify(store.queue)).not.toContain('secret-101');
    expect(store.ehTokenInput).toBe('');
    resolveEh(ehResult(101));
    await idle(store);
    expect(mocks.downloadGallery).toHaveBeenCalledWith({ gid: 101, token: 'secret-101', pageIndices: undefined });
    expect(mocks.downloadHitomi).toHaveBeenCalledWith({ id: 202, pageIndices: undefined });
    expect(store.ehHistory[0]).toMatchObject({ gid: 101, coverPath: 'D:\\Eh\\101\\data\\cover.jpg' });
    expect(store.hitomiHistory[0]).toMatchObject({ gid: -202, downloadedPages: 3 });
  });

  it('reports progress on the active card while the waiting card remains at zero', async () => {
    let report!: (event: { gid: number; page: number; total_pages: number; percent: number; text: string }) => void;
    let resolveFirst!: (result: EhDownloadResult) => void;
    mocks.listenHitomiProgress.mockImplementationOnce(async (handler: typeof report) => { report = handler; return () => undefined; });
    mocks.downloadHitomi.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(hitomiResult(302));
    const store = useEhDownloadStore();
    store.hitomiIdInput = '301'; store.enqueueHitomi();
    await vi.waitFor(() => expect(mocks.downloadHitomi).toHaveBeenCalledTimes(1));
    store.hitomiIdInput = '302'; store.enqueueHitomi();
    report({ gid: -301, page: 1, total_pages: 3, percent: 33, text: '已处理第 1 页' });
    expect(store.hitomiQueue.map((job) => job.progressPercent)).toEqual([33, 0]);
    resolveFirst(hitomiResult(301));
    await idle(store);
  });

  it('keeps failed pages under the right work and retries only those pages', async () => {
    mocks.downloadGallery.mockResolvedValueOnce(ehResult(401, 2, [{ page: 3, reason: '超时' }]))
      .mockResolvedValueOnce(ehResult(401, 1));
    const store = useEhDownloadStore();
    store.ehGidInput = '401'; store.ehTokenInput = 'token-401'; store.enqueueEh();
    await idle(store);
    expect(store.ehHistory[0]).toMatchObject({ downloadedPages: 2, failedPages: [3] });
    store.retryHistoryPages(store.ehHistory[0]);
    await idle(store);
    expect(mocks.downloadGallery).toHaveBeenLastCalledWith({ gid: 401, token: 'token-401', pageIndices: [3] });
    expect(store.ehHistory[0]).toMatchObject({ downloadedPages: 3, failedPages: [] });
  });

  it('persists a fatal error as a retryable card and continues with the next work', async () => {
    mocks.downloadHitomi.mockRejectedValueOnce(new Error('封面写入失败')).mockResolvedValueOnce(hitomiResult(502))
      .mockResolvedValueOnce(hitomiResult(501));
    const store = useEhDownloadStore();
    store.hitomiIdInput = '501'; store.enqueueHitomi();
    store.hitomiIdInput = '502'; store.enqueueHitomi();
    await idle(store);
    expect(store.hitomiHistory.find((item) => item.gid === -501)).toMatchObject({
      totalPages: 0, failedPages: [], error: '封面写入失败',
    });
    expect(store.hitomiHistory.find((item) => item.gid === -502)?.error).toBeUndefined();
    store.retryHistoryPages(store.hitomiHistory.find((item) => item.gid === -501)!);
    await idle(store);
    expect(mocks.downloadHitomi).toHaveBeenLastCalledWith({ id: 501, pageIndices: undefined });
    expect(store.hitomiHistory.find((item) => item.gid === -501)?.error).toBeUndefined();
  });

  it('does not reuse another work token when retrying historical Eh failures', async () => {
    const store = useEhDownloadStore();
    store.history = [historyItem(601, [{ page: 3, reason: '超时' }])];
    store.ehGidInput = '999'; store.ehTokenInput = 'token-for-999';
    store.retryHistoryPages(store.history[0]);
    expect(store.ehGidInput).toBe('601');
    expect(store.ehTokenInput).toBe('');
    expect(store.messages.eh?.text).toContain('Token');
    expect(mocks.downloadGallery).not.toHaveBeenCalled();
    store.ehTokenInput = 'token-601';
    mocks.downloadGallery.mockResolvedValueOnce(ehResult(601, 1));
    store.retryHistoryPages(store.history[0]);
    await idle(store);
    expect(mocks.downloadGallery).toHaveBeenCalledWith({ gid: 601, token: 'token-601', pageIndices: [3] });
  });

  it('recovers old history failures and keeps up to twenty entries per source', () => {
    const rows = [...Array.from({ length: 24 }, (_, index) => historyItem(index + 1)),
      ...Array.from({ length: 24 }, (_, index) => historyItem(-index - 1))];
    rows[0].failedPages = [3]; rows[0].failures = [];
    vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify(rows), setItem: vi.fn() } });
    const store = useEhDownloadStore();
    expect([store.ehHistory.length, store.hitomiHistory.length]).toEqual([20, 20]);
    expect(store.ehHistory[0].failures).toEqual([{ page: 3, reason: '下载失败' }]);
  });

  it('confirms deletion through the existing modal without deleting local files for database-only removal', async () => {
    const store = useEhDownloadStore();
    store.history = [historyItem(701)];
    await store.deleteHistory(701, false);
    expect(mocks.askConfirm).toHaveBeenCalledWith(
      '移除数据库记录', expect.stringContaining('本地文件夹及图片不会被删除'), '移除记录', true,
    );
    expect(mocks.deleteRecord).toHaveBeenCalledWith(701);
    expect(mocks.deleteFolder).not.toHaveBeenCalled();
    expect(store.history).toHaveLength(0);
  });
});
