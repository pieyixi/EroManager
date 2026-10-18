import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EhDownloadResult, EhGallerySummary } from '../api/contracts/eh';
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
  libraryLoad: vi.fn().mockResolvedValue(undefined),
  showDetail: vi.fn(),
}));
const library = { galleries: [] as EhGallerySummary[], load: mocks.libraryLoad, showDetail: mocks.showDetail,
  error: '', currentSort: '', currentPage: 1 };
const navigation = { askConfirm: mocks.askConfirm, pageRevision: 0 };
vi.mock('../api/commands/eh', () => ({ ehApi: mocks }));
vi.mock('../api/commands/settings', () => ({ settingsApi: mocks }));
vi.mock('../api/commands/system', () => ({ systemApi: { openFolder: vi.fn() } }));
vi.mock('../api/tauri', () => ({ pickDirectory: vi.fn() }));
vi.mock('./ehLibrary', () => ({ useEhLibraryStore: () => library }));
vi.mock('./navigation', () => ({ useNavigationStore: () => navigation }));

import { isDownloadComplete, useEhDownloadStore } from './ehDownload';
import { usePreferencesStore } from './preferences';

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
  failures, queuedAt: '2026-10-11T00:00:00.000Z', completedAt: '2026-10-11T00:00:00.000Z',
});
async function idle(store: ReturnType<typeof useEhDownloadStore>): Promise<void> {
  await vi.waitFor(() => { expect(store.workerRunning).toBe(false); expect(store.queue).toHaveLength(0); });
}

describe('Eh and Hitomi download queue', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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
    mocks.libraryLoad.mockResolvedValue(undefined);
    library.galleries = [];
    library.error = '';
    navigation.pageRevision = 0;
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

  it('opens the matching completed work without mixing same-number Eh and Hitomi IDs', async () => {
    const store = useEhDownloadStore();
    store.history = [historyItem(123), historyItem(-123)];
    // Only identity is consumed by this action; the detail receives the original library object.
    const eh = { gid: 123, title: 'Eh' } as EhGallerySummary;
    const hitomi = { gid: -123, title: 'Hitomi' } as EhGallerySummary;
    library.galleries = [eh, hitomi];
    await store.openCompletedGallery(123);
    expect(mocks.showDetail).toHaveBeenLastCalledWith(eh, 'page-eh-download');
    await store.openCompletedGallery(-123);
    expect(mocks.showDetail).toHaveBeenLastCalledWith(hitomi, 'page-eh-download');
    expect(mocks.libraryLoad).not.toHaveBeenCalled();
    expect(mocks.downloadGallery).not.toHaveBeenCalled();
    expect(mocks.downloadHitomi).not.toHaveBeenCalled();
  });

  it('refreshes a missing library entry before opening and reports deleted entries without navigating', async () => {
    const store = useEhDownloadStore();
    store.history = [historyItem(-124), historyItem(125)];
    const gallery = { gid: -124, title: 'Hitomi' } as EhGallerySummary;
    mocks.libraryLoad.mockImplementationOnce(async () => { library.galleries = [gallery]; });
    await store.openCompletedGallery(-124);
    expect(mocks.libraryLoad).toHaveBeenCalledTimes(1);
    expect(mocks.showDetail).toHaveBeenCalledWith(gallery, 'page-eh-download');
    await store.openCompletedGallery(125);
    expect(mocks.showDetail).toHaveBeenCalledTimes(1);
    expect(store.messages.eh?.text).toContain('找不到');
    library.error = '读取作品库失败';
    await store.openCompletedGallery(125);
    expect(store.messages.eh?.text).toBe('读取作品库失败');
  });

  it('does not reopen details if the user leaves downloads during a library refresh', async () => {
    const store = useEhDownloadStore();
    store.history = [historyItem(125)];
    let finish!: () => void;
    mocks.libraryLoad.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const opening = store.openCompletedGallery(125);
    navigation.pageRevision++;
    library.galleries = [{ gid: 125 } as EhGallerySummary];
    finish();
    await opening;
    expect(mocks.showDetail).not.toHaveBeenCalled();
  });

  it('never opens failed, incomplete, unknown, queued or downloading works', async () => {
    const store = useEhDownloadStore();
    const failed = historyItem(126, [{ page: 3, reason: '超时' }]);
    const incomplete = { ...historyItem(127), downloadedPages: 2 };
    const zeroPages = { ...historyItem(128), totalPages: 0, downloadedPages: 0 };
    const error = { ...historyItem(129), error: '入库失败' };
    store.history = [failed, incomplete, zeroPages, error, historyItem(130), historyItem(-131)];
    store.queue = [
      { key: 'eh:130', source: 'eh', id: 130, title: '等待', status: 'queued', progressPercent: 0,
        progressText: '', totalPages: 3, downloadedPages: 0, coverPath: '', queuedAt: '2026-10-11T01:00:00.000Z' },
      { key: 'hitomi:131', source: 'hitomi', id: 131, title: '下载中', status: 'downloading', progressPercent: 33,
        progressText: '', totalPages: 3, downloadedPages: 1, coverPath: '', queuedAt: '2026-10-11T02:00:00.000Z' },
    ];
    for (const item of [failed, incomplete, zeroPages, error]) expect(isDownloadComplete(item)).toBe(false);
    for (const gid of [126, 127, 128, 129, 130, -131, 999]) await store.openCompletedGallery(gid);
    expect(mocks.showDetail).not.toHaveBeenCalled();
    expect(mocks.libraryLoad).not.toHaveBeenCalled();
  });

  it('starts Hitomi while Eh is still running and keeps source histories separate', async () => {
    let resolveEh!: (result: EhDownloadResult) => void;
    mocks.downloadGallery.mockImplementationOnce(() => new Promise((resolve) => { resolveEh = resolve; }));
    mocks.downloadHitomi.mockResolvedValueOnce(hitomiResult(202));
    const store = useEhDownloadStore();
    store.ehGidInput = '101'; store.ehTokenInput = 'secret-101';
    store.enqueueEh();
    await vi.waitFor(() => expect(mocks.downloadGallery).toHaveBeenCalledTimes(1));
    store.hitomiIdInput = '202';
    store.enqueueHitomi();
    await vi.waitFor(() => expect(mocks.downloadHitomi).toHaveBeenCalledOnce());
    expect(store.workersRunning.eh).toBe(true);
    await vi.waitFor(() => expect(store.hitomiHistory).toHaveLength(1));
    expect(store.ehHistory).toHaveLength(0);
    expect(JSON.stringify(store.queue)).not.toContain('secret-101');
    expect(store.ehTokenInput).toBe('');
    resolveEh(ehResult(101));
    await idle(store);
    expect(mocks.downloadGallery).toHaveBeenCalledWith({ gid: 101, token: 'secret-101', pageIndices: undefined, parallelImages: 3 });
    expect(mocks.downloadHitomi).toHaveBeenCalledWith({ id: 202, pageIndices: undefined, parallelImages: 3 });
    expect(store.ehHistory[0]).toMatchObject({ gid: 101, coverPath: 'D:\\Eh\\101\\data\\cover.jpg' });
    expect(store.hitomiHistory[0]).toMatchObject({ gid: -202, downloadedPages: 3 });
  });

  it('snapshots each source concurrency at work start, including the next queued work', async () => {
    const preferences = usePreferencesStore();
    preferences.values.eh_parallel_images = 1;
    preferences.values.hitomi_parallel_images = 5;
    let finish!: (result: EhDownloadResult) => void;
    mocks.downloadGallery.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(ehResult(102));
    mocks.downloadHitomi.mockResolvedValueOnce(hitomiResult(101));
    const store = useEhDownloadStore();
    store.ehGidInput = '101'; store.ehTokenInput = 'one'; store.enqueueEh();
    await vi.waitFor(() => expect(mocks.downloadGallery).toHaveBeenCalledOnce());
    store.ehGidInput = '102'; store.ehTokenInput = 'two'; store.enqueueEh();
    preferences.values.eh_parallel_images = 2;
    store.hitomiIdInput = '101'; store.enqueueHitomi();
    await vi.waitFor(() => expect(mocks.downloadHitomi).toHaveBeenCalledOnce());
    expect(mocks.downloadGallery.mock.calls[0][0].parallelImages).toBe(1);
    expect(mocks.downloadHitomi.mock.calls[0][0].parallelImages).toBe(5);
    finish(ehResult(101)); await idle(store);
    expect(mocks.downloadGallery.mock.calls[1][0].parallelImages).toBe(2);
  });

  it('keeps FIFO within each source without duplicate workers and isolates same-ID progress', async () => {
    const ehResolvers: Array<(result: EhDownloadResult) => void> = [];
    const hitomiResolvers: Array<(result: EhDownloadResult) => void> = [];
    mocks.downloadGallery.mockImplementation(() => new Promise(resolve => ehResolvers.push(resolve)));
    mocks.downloadHitomi.mockImplementation(() => new Promise(resolve => hitomiResolvers.push(resolve)));
    const stopEh = vi.fn(), stopHitomi = vi.fn();
    mocks.listenDownloadProgress.mockResolvedValue(stopEh);
    mocks.listenHitomiProgress.mockResolvedValue(stopHitomi);
    const store = useEhDownloadStore();
    store.enqueue('eh', 101, 'secret-a'); store.enqueue('hitomi', 101);
    store.enqueue('eh', 102, 'secret-b'); store.enqueue('hitomi', 102);
    await vi.waitFor(() => { expect(ehResolvers).toHaveLength(1); expect(hitomiResolvers).toHaveLength(1); });
    await store.processQueue(); // 已在运行的两路不可重复启动。
    expect(store.queue.map(job => job.status)).toEqual(['downloading', 'downloading', 'queued', 'queued']);
    const event = { gid: 101, page: 1, total_pages: 3, percent: 33, text: 'Eh progress' };
    mocks.listenDownloadProgress.mock.calls[0][0](event);
    expect(store.ehQueue[0].progressPercent).toBe(33);
    expect(store.hitomiQueue[0].progressPercent).toBe(0);
    mocks.listenHitomiProgress.mock.calls[0][0]({ ...event, gid: -101, percent: 67 });
    expect(store.hitomiQueue[0].progressPercent).toBe(67);
    ehResolvers[0](ehResult(101));
    await vi.waitFor(() => expect(ehResolvers).toHaveLength(2));
    expect(hitomiResolvers).toHaveLength(1); // Hitomi 的下一部仍须等待本路第一部。
    expect(mocks.downloadGallery.mock.calls.map(call => call[0].gid)).toEqual([101, 102]);
    ehResolvers[1](ehResult(102));
    await vi.waitFor(() => expect(store.workersRunning.eh).toBe(false));
    expect(store.downloading).toBe(true); // 另一边还在下载，壳层指示不能熄灭。
    hitomiResolvers[0](hitomiResult(101));
    await vi.waitFor(() => expect(hitomiResolvers).toHaveLength(2));
    hitomiResolvers[1](hitomiResult(102)); await idle(store);
    expect(mocks.downloadHitomi.mock.calls.map(call => call[0].id)).toEqual([101, 102]);
    expect(store.history).toHaveLength(4);
    expect(stopEh).toHaveBeenCalledTimes(2); expect(stopHitomi).toHaveBeenCalledTimes(2);
    expect(store.cards.filter(card => card.source === 'eh').map(card => card.gid)).toEqual([102, 101]);
    expect(store.cards.filter(card => card.source === 'hitomi').map(card => card.gid)).toEqual([-102, -101]);
    expect(JSON.stringify(store.history)).not.toContain('secret-');
  });

  it('continues both queues after one source fails and retries without blocking the other', async () => {
    let finishHitomi!: (result: EhDownloadResult) => void;
    mocks.downloadGallery.mockRejectedValueOnce(new Error('Eh offline')).mockResolvedValue(ehResult(101));
    mocks.downloadHitomi.mockImplementation(() => new Promise(resolve => { finishHitomi = resolve; }));
    const store = useEhDownloadStore();
    store.enqueue('eh', 101, 'secret-a'); store.enqueue('hitomi', 101);
    await vi.waitFor(() => { expect(store.ehHistory[0]?.error).toBe('Eh offline'); expect(mocks.downloadHitomi).toHaveBeenCalledOnce(); });
    expect(store.workersRunning.hitomi).toBe(true);
    store.ehGidInput = '101'; store.ehTokenInput = 'secret-a';
    store.retryHistoryPages(store.ehHistory[0]);
    await vi.waitFor(() => expect(isDownloadComplete(store.ehHistory[0])).toBe(true));
    expect(store.workersRunning.hitomi).toBe(true);
    finishHitomi(hitomiResult(101)); await idle(store);
    expect(store.hitomiHistory[0].gid).toBe(-101);
  });

  it('serializes overlapping shared-library refreshes and schedules a final up-to-date reload', async () => {
    let finishFirst!: () => void;
    mocks.libraryLoad.mockImplementationOnce(() => new Promise<void>(resolve => { finishFirst = resolve; }));
    const store = useEhDownloadStore();
    const first = store.refreshLibrary();
    await store.refreshLibrary(); await store.refreshLibrary();
    expect(mocks.libraryLoad).toHaveBeenCalledOnce();
    finishFirst(); await first;
    expect(mocks.libraryLoad).toHaveBeenCalledTimes(2);
    expect(store.libraryRefreshing).toBe(false);
  });

  it('stacks newest work before all cards and keeps its slot through completion and clock rollback', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-12T00:00:00.000Z'));
    const store = useEhDownloadStore();
    store.workersRunning = { eh: true, hitomi: true };
    store.history = [historyItem(-900)];
    for (const id of [101, 102, 103]) store.enqueue('hitomi', id);
    const order = [-103, -102, -101, -900];
    expect(store.cards.map((card) => card.gid)).toEqual(order);
    expect(new Set(store.queue.map((job) => job.queuedAt)).size).toBe(3);
    const first = store.queue[0];
    first.status = 'downloading'; first.progressPercent = 90;
    expect(store.cards.map((card) => card.gid)).toEqual(order);
    store.rememberResult(hitomiResult(101), first);
    store.queue = store.queue.filter((job) => job.key !== first.key);
    expect(store.cards.map((card) => card.gid)).toEqual(order);
    expect(store.cards[2]).toMatchObject({ key: first.key, kind: 'history', queuedAt: first.queuedAt });
    store.removeQueued('hitomi:102');
    clock.mockReturnValue(Date.parse('2020-01-01T00:00:00.000Z'));
    store.enqueue('hitomi', 104);
    expect(store.cards.map((card) => card.gid)).toEqual([-104, -103, -101, -900]);
    expect(mocks.downloadHitomi).not.toHaveBeenCalled();
  });

  it('keeps one card and its original slot through failure, retry and successful completion', () => {
    const store = useEhDownloadStore();
    store.workersRunning = { eh: true, hitomi: true };
    store.history = [historyItem(-300), historyItem(-200, [{ page: 3, reason: '超时' }]), historyItem(-100)]
      .map((item) => ({ ...item, queuedAt: `2026-10-11T0${Math.abs(item.gid) / 100}:00:00.000Z` }));
    const order = [-300, -200, -100];
    const originalTime = store.history.find((item) => item.gid === -200)!.queuedAt;
    store.retryHistoryPages(store.history.find((item) => item.gid === -200)!);
    expect(store.cards.map((card) => card.gid)).toEqual(order);
    expect(store.cards[1]).toMatchObject({ key: 'hitomi:200', kind: 'queue', queuedAt: originalTime });
    store.rememberError(store.queue[0], new Error('再次超时'));
    store.queue = [];
    expect(store.cards.map((card) => card.gid)).toEqual(order);
    store.retryHistoryPages(store.history.find((item) => item.gid === -200)!);
    store.rememberResult(hitomiResult(200), store.queue[0]);
    store.queue = [];
    expect(store.cards.map((card) => card.gid)).toEqual(order);
    expect(store.cards[1]).toMatchObject({ key: 'hitomi:200', kind: 'history', queuedAt: originalTime });
    expect(store.history.find((item) => item.gid === -200)?.failedPages).toEqual([]);
  });

  it('recovers admission times from legacy history and persists stable order without credentials', () => {
    const old = historyItem(801); const newer = historyItem(-802);
    let encoded = JSON.stringify([
      { ...newer, queuedAt: 'invalid-time', completedAt: '2026-10-11T02:00:00.000Z' },
      { ...old, queuedAt: undefined, completedAt: '2026-10-11T01:00:00.000Z' },
    ]);
    vi.stubGlobal('window', { localStorage: {
      getItem: () => encoded, setItem: (_key: string, value: string) => { encoded = value; },
    } });
    const store = useEhDownloadStore();
    expect(store.cards.map((card) => card.gid)).toEqual([-802, 801]);
    expect(store.history.find((item) => item.gid === 801)?.queuedAt).toBe('2026-10-11T01:00:00.000Z');
    store.workersRunning = { eh: true, hitomi: true };
    store.enqueue('eh', 803, 'never-persist-this-token');
    const admitted = store.queue[0].queuedAt;
    store.rememberResult(ehResult(803), store.queue[0]);
    store.queue = [];
    expect(encoded).not.toContain('never-persist-this-token');
    setActivePinia(createPinia());
    const restored = useEhDownloadStore();
    expect(restored.cards.map((card) => card.gid)).toEqual([803, -802, 801]);
    expect(restored.history.find((item) => item.gid === 803)?.queuedAt).toBe(admitted);
    expect(restored.queue).toEqual([]);
  });

  it('replaces only the matching source card when retrying same-number Eh and Hitomi works', () => {
    const store = useEhDownloadStore();
    store.workersRunning = { eh: true, hitomi: true };
    store.history = [historyItem(50), historyItem(-50, [{ page: 3, reason: '超时' }])];
    const keys = store.cards.map((card) => card.key);
    store.retryHistoryPages(store.hitomiHistory[0]);
    expect(store.cards.map((card) => card.key)).toEqual(keys);
    expect(store.cards.map((card) => [card.source, card.kind])).toEqual([['eh', 'history'], ['hitomi', 'queue']]);
    expect(store.cards).toHaveLength(2);
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
    expect(mocks.downloadGallery).toHaveBeenLastCalledWith({ gid: 401, token: 'token-401', pageIndices: [3], parallelImages: 3 });
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
    expect(mocks.downloadHitomi).toHaveBeenLastCalledWith({ id: 501, pageIndices: undefined, parallelImages: 3 });
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
    expect(mocks.downloadGallery).toHaveBeenCalledWith({ gid: 601, token: 'token-601', pageIndices: [3], parallelImages: 3 });
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
