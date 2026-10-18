import { beforeEach, describe, expect, it, vi } from "vitest";
import { ehApi } from '../api/commands/eh';
import { createPinia, setActivePinia } from "pinia";
import { ehDisplayValue, useEhLibraryStore, type EhGallerySummary } from "./ehLibrary";

const gallery: EhGallerySummary = {
  gid: 1,
  token: "test-token",
  source: "eh",
  source_id: "1",
  language: "",
  title: "测试作品",
  category: 2,
  artist: ["1-gou"],
  artist_display: ["1号"],
  group: ["0846net"],
  group_display: ["オヤシロネット"],
  tags: ["big breasts"],
  tags_display: ["巨乳"],
  pages: 10,
  posted: "2026-01-01",
  added_at: "2026-09-01 12:00:00",
  cover_path: "",
  folder_path: "D:\\Ehentai\\1",
};

describe("Eh translated metadata", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("uses localized labels without replacing canonical filter values", () => {
    const store = useEhLibraryStore();
    store.galleries = [gallery];
    expect(store.options("artist")).toEqual(["1-gou"]);
    expect(store.optionLabel("artist", "1-gou")).toBe("1号");
    store.toggleFilter("artist", "1-gou");
    expect(store.filteredGalleries).toEqual([gallery]);
  });

  it.each(["1-gou", "1号", "0846net", "オヤシロネット", "big breasts", "巨乳"])(
    "finds a gallery using %s",
    (query) => {
      const store = useEhLibraryStore();
      store.galleries = [gallery];
      store.search = query;
      expect(store.filteredGalleries).toEqual([gallery]);
    },
  );

  it("falls back to the canonical value when a translation is absent", () => {
    expect(ehDisplayValue({ ...gallery, artist_display: [] }, "artist", "1-gou")).toBe("1-gou");
  });

  it("defaults to newest admission first and keeps publication sorting independent", () => {
    const store = useEhLibraryStore();
    const older = { ...gallery, gid: 2, title: "较晚发布", posted: "2026-08-01", added_at: "2026-08-01 10:00:00" };
    const newer = { ...gallery, gid: 3, title: "较早发布但刚入库", posted: "2010-01-01", added_at: "2026-09-01 10:00:00" };
    store.galleries = [older, newer];

    expect(store.currentSort).toBe("added-desc");
    expect(store.filteredGalleries.map((item) => item.gid)).toEqual([3, 2]);
    store.toggleAddedSort();
    expect(store.currentSort).toBe("added-asc");
    expect(store.filteredGalleries.map((item) => item.gid)).toEqual([2, 3]);
    store.toggleAddedSort();
    expect(store.filteredGalleries.map((item) => item.gid)).toEqual([3, 2]);
    store.toggleTimeSort();
    expect(store.currentSort).toBe("time-desc");
    expect(store.filteredGalleries.map((item) => item.gid)).toEqual([2, 3]);
  });

  it("keeps colliding Eh and Hitomi IDs separate through search, filters and admission sorting", () => {
    const store = useEhLibraryStore();
    const eh = { ...gallery, gid: 123, source: 'eh' as const, source_id: '123', added_at: '2026-01-01 00:00:00' };
    const hitomi = { ...gallery, gid: -123, source: 'hitomi' as const, source_id: '123',
      title: 'Hitomi 专属作品', category: 4, tags: ['sole female'], tags_display: ['单女主'],
      added_at: '2026-09-01 00:00:00' };
    store.galleries = [eh, hitomi];
    store.currentSort = 'added-desc';
    expect(store.filteredGalleries.map((item) => item.gid)).toEqual([-123, 123]);
    store.search = '123';
    expect(store.filteredGalleries).toHaveLength(2);
    store.search = '专属';
    expect(store.filteredGalleries.map((item) => item.gid)).toEqual([-123]);
    store.search = '';
    store.toggleFilter('tag', 'sole female');
    expect(store.filteredGalleries.map((item) => item.gid)).toEqual([-123]);
    store.clearFilter('tag');
    store.toggleFilter('category', '4');
    expect(store.filteredGalleries.map((item) => item.gid)).toEqual([-123]);
  });
});

describe('book favorites', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.restoreAllMocks(); });

  it('filters signed source IDs independently and composes with search/tags', () => {
    const store = useEhLibraryStore();
    store.galleries = [gallery, { ...gallery, gid: -1, source: 'hitomi', title: 'Hitomi book' }];
    store.favoriteGids = [-1]; store.currentPage = 5;
    store.toggleFavoriteMode();
    expect(store.currentPage).toBe(1);
    expect(store.filteredGalleries.map(item => item.gid)).toEqual([-1]);
    store.search = '测试'; expect(store.filteredGalleries).toEqual([]);
    store.search = ''; store.toggleFilter('tag', 'missing'); expect(store.filteredGalleries).toEqual([]);
    expect(store.showClearButton).toBe(true);
    store.clearSearchAndFilters();
    expect(store.favoriteMode).toBe(false); expect(store.filteredGalleries).toHaveLength(2);
  });

  it('merges out-of-order saves and ignores duplicate clicks while saving', async () => {
    const store = useEhLibraryStore();
    const resolve: Array<(favorite: boolean) => void> = [];
    const save = vi.spyOn(ehApi, 'setFavorite').mockImplementation(() => new Promise(done => resolve.push(done)));
    const first = store.toggleFavorite(1), second = store.toggleFavorite(-1);
    await store.toggleFavorite(1);
    expect(save).toHaveBeenCalledTimes(2);
    resolve[1](true); await second; resolve[0](true); await first;
    expect(new Set(store.favoriteGids)).toEqual(new Set([1, -1]));
    expect(store.favoriteSaving).toEqual([]);
    save.mockResolvedValue(false);
    await store.toggleFavorite(1); expect(store.favoriteGids).toEqual([-1]);
    store.favoriteMode = true;
    await store.toggleFavorite(-1); expect(store.favoriteMode).toBe(false);
  });

  it('keeps the last confirmed favorite state on a failed save', async () => {
    const store = useEhLibraryStore(); store.favoriteGids = [1];
    vi.spyOn(ehApi, 'setFavorite').mockRejectedValue(new Error('disk unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await store.toggleFavorite(1);
    expect(store.favoriteGids).toEqual([1]); expect(store.favoriteSaving).toEqual([]);
    expect(log).toHaveBeenCalledOnce();
  });
});
