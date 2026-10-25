import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { setAccountScope } from '../api/accountContext';
import { createAvScene } from '../api/mock/avScene';
import { avApi } from '../api/commands/av';
import { useAvLibraryStore } from './avLibrary';
import { useAvDownloadStore } from './avDownload';
vi.mock('../api/commands/av', () => ({ avApi: { fetchWork: vi.fn(), settings: vi.fn(), bindRoot: vi.fn(), listWorks: vi.fn() } }));
describe('JavDB fetch queue', () => {
  beforeEach(() => { setActivePinia(createPinia()); setAccountScope('owner'); vi.clearAllMocks(); vi.mocked(avApi.listWorks).mockResolvedValue([]); });
  it('runs one FIFO request, rejects duplicates, and indexes completed work once', async () => {
    const store = useAvDownloadStore(); store.root = 'fixture';
    let finish!: (value: { work: ReturnType<typeof createAvScene>[number]; warnings: string[] }) => void;
    const work = createAvScene()[0]!;
    vi.mocked(avApi.fetchWork).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ work: { ...work, code: 'TEST-102' }, warnings: [] });
    store.input = 'test101'; store.enqueue(); store.input = 'TEST-102'; store.enqueue(); store.input = 'TEST-101'; store.enqueue();
    expect(store.jobs.length).toBe(2); expect(avApi.fetchWork).toHaveBeenCalledTimes(1);
    expect(store.cards[0]?.code).toBe('TEST-102');
    expect(vi.mocked(avApi.fetchWork).mock.calls[0]?.[2]).toBe(store.jobs[0]?.admitted);
    finish({ work: { ...work, code: 'TEST-101' }, warnings: [] });
    await vi.waitFor(() => expect(store.running).toBe(false));
    expect(vi.mocked(avApi.fetchWork).mock.calls.map(call => call[0])).toEqual(['TEST-101', 'TEST-102']);
    expect(store.jobs.every(job => job.status === 'complete')).toBe(true);
    expect(useAvLibraryStore().works.length).toBe(2);
  });
  it('keeps failed cards visible for retry and suppresses old-account indexing', async () => {
    const store = useAvDownloadStore(); store.root = 'fixture';
    vi.mocked(avApi.fetchWork).mockRejectedValueOnce(Error('network'));
    store.input = 'TEST-103'; store.enqueue(); await vi.waitFor(() => expect(store.running).toBe(false));
    expect(store.cards[0]?.status).toBe('failed');
    let finish!: (value: { work: ReturnType<typeof createAvScene>[number]; warnings: string[] }) => void;
    vi.mocked(avApi.fetchWork).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    store.retry('TEST-103'); setAccountScope('next-owner');
    finish({ work: { ...createAvScene()[0]!, code: 'TEST-103' }, warnings: [] });
    await vi.waitFor(() => expect(store.running).toBe(false));
    expect(store.jobs).toHaveLength(1); expect(store.cards[0]?.status).toBe('complete');
    expect(useAvLibraryStore().works).toHaveLength(0);
  });
  it('keeps a late settings read from undoing the newly chosen data directory', async () => {
    const store = useAvDownloadStore();
    let finish!: (value: { root_path: string }) => void;
    vi.mocked(avApi.settings).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    vi.mocked(avApi.bindRoot).mockResolvedValueOnce({ root_path: 'new-directory' });
    const pending = store.loadSettings(); await store.bindRoot('new-directory');
    finish({ root_path: 'old-directory' }); await pending;
    expect(store.root).toBe('new-directory'); expect(store.directoryFailed).toBe(false);
  });
  it('does not start a settings read while a directory save is pending', async () => {
    const store = useAvDownloadStore();
    let finish!: (value: { root_path: string }) => void;
    vi.mocked(avApi.bindRoot).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = store.bindRoot('new-directory');
    expect(await store.loadSettings()).toBe(false); expect(avApi.settings).not.toHaveBeenCalled();
    finish({ root_path: 'new-directory' }); await pending;
    expect(store.root).toBe('new-directory');
  });
});
