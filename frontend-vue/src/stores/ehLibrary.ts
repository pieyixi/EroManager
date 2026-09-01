import { defineStore } from "pinia";
import { invokeTauri } from "../api/tauri";
import { useNavigationStore } from "./navigation";

export type EhFilterKey = "category" | "artist" | "group" | "tag";
export type EhSortKey = "time-desc" | "time-asc" | "name-asc" | "name-desc";
export function ehCategoryLabel(value: number | string): string {
  return ({
    1: "Misc", 2: "Doujinshi", 4: "Manga", 8: "Artist CG",
    16: "Game CG", 32: "Image Set", 64: "Cosplay",
    128: "Asian Porn", 256: "Non-H", 512: "Western",
  } as Record<number, string>)[Number(value)] || String(value);
}
export interface EhGallerySummary {
  gid: number;
  title: string;
  category: number | string;
  artist: string[];
  group: string[];
  tags: string[];
  artist_display?: string[];
  group_display?: string[];
  tags_display?: string[];
  pages: number;
  posted: string;
  cover_path: string;
  folder_path: string;
}

type EhTextFilterKey = Exclude<EhFilterKey, "category">;

export function ehDisplayValues(gallery: EhGallerySummary, key: EhTextFilterKey): string[] {
  const source = key === "tag" ? gallery.tags : gallery[key];
  const displayKey = key === "tag" ? "tags_display" : `${key}_display` as "artist_display" | "group_display";
  const display = gallery[displayKey];
  return display?.length === source.length ? display : source;
}

export function ehDisplayValue(gallery: EhGallerySummary, key: EhTextFilterKey, value: string): string {
  const source = key === "tag" ? gallery.tags : gallery[key];
  const index = source.indexOf(value);
  return index >= 0 ? ehDisplayValues(gallery, key)[index] || value : value;
}
export interface EhLibraryOverview {
  root_path: string;
  database_path: string;
  total_count: number;
  total_pages: number;
}

let coverGeneration = 0;
const pendingCoverLoads = new Map<
  string,
  { generation: number; promise: Promise<void> }
>();

export const useEhLibraryStore = defineStore("ehLibrary", {
  state: () => ({
    overview: null as EhLibraryOverview | null,
    galleries: [] as EhGallerySummary[],
    coverCache: {} as Record<string, string>,
    search: "",
    activeFilters: {} as Record<EhFilterKey, string[]>,
    openDropdown: null as EhFilterKey | null,
    currentSort: "time-desc" as EhSortKey,
    currentPage: 1,
    pageSize: 20,
    loading: false,
    error: "",
    currentGallery: null as EhGallerySummary | null,
  }),
  getters: {
    filteredGalleries(state): EhGallerySummary[] {
      const keyword = state.search.trim().toLocaleLowerCase();
      const values = (gallery: EhGallerySummary, key: EhFilterKey): string[] =>
        key === "category"
          ? [String(gallery.category)]
          : key === "tag"
            ? gallery.tags
            : gallery[key];
      return state.galleries
        .filter((gallery) =>
          (
            Object.entries(state.activeFilters) as Array<
              [EhFilterKey, string[]]
            >
          ).every(
            ([key, selected]) =>
              !selected.length ||
              selected.some((item) => values(gallery, key).includes(item)),
          ),
        )
        .filter(
          (gallery) =>
            !keyword ||
            [
              gallery.title,
              String(gallery.category),
              ...gallery.artist,
              ...ehDisplayValues(gallery, "artist"),
              ...gallery.group,
              ...ehDisplayValues(gallery, "group"),
              ...gallery.tags,
              ...ehDisplayValues(gallery, "tag"),
            ].some((value) => value.toLocaleLowerCase().includes(keyword)),
        )
        .sort((left, right) =>
          state.currentSort === "time-desc"
            ? right.posted.localeCompare(left.posted)
            : state.currentSort === "time-asc"
              ? left.posted.localeCompare(right.posted)
              : state.currentSort === "name-desc"
                ? right.title.localeCompare(left.title)
                : left.title.localeCompare(right.title),
        );
    },
    totalPages(): number {
      return Math.max(
        1,
        Math.ceil(this.filteredGalleries.length / this.pageSize),
      );
    },
    pagedGalleries(): EhGallerySummary[] {
      return this.filteredGalleries.slice(
        (this.currentPage - 1) * this.pageSize,
        this.currentPage * this.pageSize,
      );
    },
    showClearButton(state): boolean {
      return Boolean(
        state.search.trim() ||
          Object.values(state.activeFilters).some((items) => items.length),
      );
    },
  },
  actions: {
    async openPage(): Promise<void> {
      useNavigationStore().showPage("page-eh-library");
      if (!this.overview && !this.loading) await this.load();
    },
    async load(): Promise<void> {
      this.loading = true;
      this.error = "";
      try {
        const [overview, galleries] = await Promise.all([
          invokeTauri<EhLibraryOverview>("eh_get_library_overview"),
          invokeTauri<EhGallerySummary[]>("eh_list_local_galleries"),
        ]);
        this.overview = overview;
        this.galleries = galleries;
        void this.loadVisibleCovers();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },
    options(key: EhFilterKey): string[] {
      return [
        ...new Set(
          this.galleries.flatMap((gallery) =>
            key === "category"
              ? [String(gallery.category)]
              : key === "tag"
                ? gallery.tags
                : gallery[key],
          ),
        ),
      ].sort((a, b) => this.optionLabel(key, a).localeCompare(this.optionLabel(key, b), "zh-CN"));
    },
    optionLabel(key: EhFilterKey, value: string): string {
      if (key === "category") return ehCategoryLabel(value);
      for (const gallery of this.galleries) {
        const source = key === "tag" ? gallery.tags : gallery[key];
        if (source.includes(value)) return ehDisplayValue(gallery, key, value);
      }
      return value;
    },
    toggleDropdown(key: EhFilterKey): void {
      this.openDropdown = this.openDropdown === key ? null : key;
    },
    closeDropdown(): void {
      this.openDropdown = null;
    },
    isFilterActive(key: EhFilterKey): boolean {
      return Boolean(this.activeFilters[key]?.length);
    },
    isSelected(key: EhFilterKey, value: string): boolean {
      return Boolean(this.activeFilters[key]?.includes(value));
    },
    toggleFilter(key: EhFilterKey, value: string): void {
      const selected = this.activeFilters[key] || [];
      this.activeFilters[key] = selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value];
      this.currentPage = 1;
    },
    clearFilter(key: EhFilterKey): void {
      this.activeFilters[key] = [];
      this.currentPage = 1;
    },
    clearSearchAndFilters(): void {
      this.search = "";
      this.activeFilters = {} as Record<EhFilterKey, string[]>;
      this.currentPage = 1;
    },
    jumpToSingleFilter(key: EhFilterKey, value: string): void {
      this.search = "";
      this.activeFilters = { [key]: [value] } as Record<EhFilterKey, string[]>;
      this.openDropdown = null;
      this.currentPage = 1;
      useNavigationStore().showPage("page-eh-library");
    },
    toggleTimeSort(): void {
      this.currentSort =
        this.currentSort === "time-desc" ? "time-asc" : "time-desc";
      this.currentPage = 1;
    },
    toggleNameSort(): void {
      this.currentSort =
        this.currentSort === "name-asc" ? "name-desc" : "name-asc";
      this.currentPage = 1;
    },
    updatePageSize(size: number): void {
      this.pageSize = Math.max(1, size);
      this.currentPage = Math.min(this.currentPage, this.totalPages);
    },
    goPage(page: number): void {
      this.currentPage = Math.max(
        1,
        Math.min(this.totalPages, Math.floor(page) || 1),
      );
      void this.loadVisibleCovers();
    },
    coverUrl(path: string): string {
      return this.coverCache[path] || "";
    },
    async loadCovers(paths: string[]): Promise<void> {
      const generation = coverGeneration;
      const waits: Promise<void>[] = [];
      const needed: string[] = [];
      [...new Set(paths.filter(Boolean))].forEach((path) => {
        if (this.coverCache[path]) return;
        const pending = pendingCoverLoads.get(path);
        if (pending?.generation === generation) waits.push(pending.promise);
        else needed.push(path);
      });
      if (needed.length) {
        let batch!: Promise<void>;
        batch = (async () => {
          try {
            const loaded = await invokeTauri<Array<[string, string]>>(
              "load_cover_cache",
              { coverPaths: needed },
            );
            if (generation === coverGeneration) {
              this.coverCache = Object.assign(
                {},
                this.coverCache,
                Object.fromEntries(loaded),
              );
            }
          } finally {
            needed.forEach((path) => {
              if (pendingCoverLoads.get(path)?.promise === batch) {
                pendingCoverLoads.delete(path);
              }
            });
          }
        })();
        needed.forEach((path) =>
          pendingCoverLoads.set(path, { generation, promise: batch }),
        );
        waits.push(batch);
      }
      await Promise.all(waits);
    },
    async loadVisibleCovers(): Promise<void> {
      await this.loadCovers(
        this.pagedGalleries.map((gallery) => gallery.cover_path),
      );
    },
    async deleteGallery(gid: number, deleteFolder: boolean): Promise<void> {
      const gallery = this.galleries.find((item) => item.gid === gid);
      if (!gallery) return;
      const navigation = useNavigationStore();
      const confirmed = await navigation.askConfirm(
        deleteFolder ? "删除本地作品" : "移除数据库记录",
        deleteFolder
          ? `确定永久删除“${gallery.title}”的整个本地文件夹？其中所有图片和 data 资料都会被删除，无法撤销。`
          : `确定仅从 Eh 数据库移除“${gallery.title}”？本地文件夹及图片不会被删除。`,
        deleteFolder ? "删除文件夹" : "移除记录",
        true,
      );
      if (!confirmed) return;
      try {
        await invokeTauri(
          deleteFolder ? "eh_delete_gallery_folder" : "eh_delete_gallery_record",
          { gid },
        );
        this.galleries = this.galleries.filter((item) => item.gid !== gid);
        const nextCache = { ...this.coverCache };
        delete nextCache[gallery.cover_path];
        this.coverCache = nextCache;
        this.currentPage = Math.min(this.currentPage, this.totalPages);
        this.overview = await invokeTauri<EhLibraryOverview>(
          "eh_get_library_overview",
        );
        void this.loadVisibleCovers();
      } catch (error) {
        this.error = `删除失败：${error instanceof Error ? error.message : String(error)}`;
      }
    },
    showDetail(gallery: EhGallerySummary): void {
      this.currentGallery = gallery;
      const navigation = useNavigationStore();
      navigation.detailSource = "eh";
      navigation.showPage("page-detail");
    },
  },
});
