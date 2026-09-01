import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ehDisplayValue, useEhLibraryStore, type EhGallerySummary } from "./ehLibrary";

const gallery: EhGallerySummary = {
  gid: 1,
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
});
