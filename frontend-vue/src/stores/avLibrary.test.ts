import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createAvScene } from '../api/mock/avScene';
import { useAvLibraryStore } from './avLibrary';
import { setAccountScope } from '../api/accountContext';
import { avApi } from '../api/commands/av';

vi.mock('../api/commands/av', () => ({ avApi: { listWorks: vi.fn() } }));
describe('AV catalog views', () => {
  beforeEach(() => { setActivePinia(createPinia()); setAccountScope('owner'); vi.clearAllMocks(); });
  function library() { const store = useAvLibraryStore(); store.works = createAvScene(); return store; }

  it('groups repeated actresses by identity, keeping same-name different people separate', () => {
    const store = library();
    expect(store.totalCount).toBe(48);
    store.toggleMode();
    expect(store.totalCount).toBe(14);
    expect(new Set(store.actressCards.map(actor => actor.id)).size).toBe(14);
    expect(store.actressCards.every(actor => new Set(actor.codes).size === actor.codes.length)).toBe(true);
    const work = structuredClone(createAvScene()[0]); work.code = 'EXTRA';
    work.actresses = [{ ...work.actresses[0], id: 'other-person' }]; store.works.push(work);
    expect(store.totalCount).toBe(15);
  });

  it('combines JSON filters across fields and keeps only matching names in co-star searches', () => {
    const store = library();
    store.toggleFilter('studio', 'Studio A'); store.toggleFilter('tag', '制服');
    expect(store.filteredWorks.length).toBeGreaterThan(0);
    expect(store.filteredWorks.every(work => work.studio === 'Studio A' && work.tags.includes('制服'))).toBe(true);
    store.clearSearchAndFilters(); store.search = '示例女优1'; store.toggleMode();
    expect(store.actressCards.map(actor => actor.id)).not.toContain('actress-2');
    store.search = '桜井あおい'; expect(store.actressCards.map(actor => actor.id)).toEqual(['actress-1']);
    store.search = 'ｄｅｍｏ－１００'; expect(store.filteredWorks.map(work => work.code)).toEqual(['DEMO-100']);
    store.search = 'no-match'; expect(store.totalCount).toBe(0); expect(store.totalPages).toBe(1);
  });

  it('keeps mode-specific pagination, clamps after resize, and resets both after filtering', () => {
    const store = library(); store.updatePageSize(4); store.goPage(6);
    store.toggleMode(); expect(store.currentPage).toBe(1); store.goPage(3);
    store.toggleMode(); expect(store.currentPage).toBe(6);
    store.toggleMode(); expect(store.currentPage).toBe(3);
    store.updatePageSize(40); expect(store.currentPage).toBe(1);
    store.updatePageSize(4); store.goPage(2); store.toggleFilter('year', '2024');
    expect(store.codePage).toBe(1); expect(store.actressPage).toBe(1);
  });

  it('discards late catalog responses after lock or account switch', async () => {
    const store = library(); let finish!: (works: ReturnType<typeof createAvScene>) => void;
    vi.mocked(avApi.listWorks).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = store.load(); setAccountScope('next-owner'); store.resetSession();
    finish(createAvScene()); await pending;
    expect(store.works).toEqual([]); expect(store.loaded).toBe(false); expect(store.loading).toBe(false);
  });
  it('preserves loaded image resources when only a magnet changes', () => {
    const store = library(); const work = store.works[0]!;
    store.coverCache['local-image'] = 'loaded';
    store.upsert({ ...work, magnets: ['magnet:?xt=sample'] }, false);
    expect(store.coverCache['local-image']).toBe('loaded');
    store.showDetail(work, 'page-av-library'); expect(store.currentWork?.code).toBe(work.code);
  });
});
