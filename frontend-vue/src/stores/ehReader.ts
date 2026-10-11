import { defineStore } from "pinia";
import { ehApi } from "../api/commands/eh";
import { mediaApi } from "../api/commands/media";
import type { EhGallerySummary, EhReaderPage } from "../api/contracts/eh";
import { useNavigationStore } from "./navigation";
export type { EhGallerySummary, EhReaderPage } from "../api/contracts/eh";
export interface EhSpread {
  pages: EhReaderPage[];
  startIndex: number;
}
export type EhPageMode = "double" | "single";
export type EhDirection = "rtl" | "ltr";
export function buildEhSpreads(
  pages: EhReaderPage[],
  mode: EhPageMode,
  offset: number,
): EhSpread[] {
  const spreads: EhSpread[] = [];
  let index = 0;
  while (index < pages.length) {
    const page = pages[index];
    const landscape = page.width > page.height;
    if (mode === "single" || landscape || index < offset) {
      spreads.push({ pages: [page], startIndex: index });
      index += 1;
      continue;
    }
    const next = pages[index + 1];
    if (next && next.width <= next.height) {
      spreads.push({ pages: [page, next], startIndex: index });
      index += 2;
    } else {
      spreads.push({ pages: [page], startIndex: index });
      index += 1;
    }
  }
  return spreads;
}
export const useEhReaderStore = defineStore("ehReader", {
  state: () => ({
    gallery: null as EhGallerySummary | null,
    pages: [] as EhReaderPage[],
    imageCache: {} as Record<string, string>,
    spreadIndex: 0,
    pageMode: "double" as EhPageMode,
    direction: "rtl" as EhDirection,
    pairOffset: 1,
    mergedPairs: {} as Record<string, boolean>,
    zoom: 100,
    toolsVisible: false,
    settingsVisible: false,
    loading: false,
    error: "",
    loadGeneration: 0,
  }),
  getters: {
    spreads(state): EhSpread[] {
      return buildEhSpreads(state.pages, state.pageMode, state.pairOffset);
    },
    currentSpread(): EhSpread | undefined {
      return this.spreads[this.spreadIndex];
    },
    currentPageNumber(): number {
      return (this.currentSpread?.startIndex || 0) + 1;
    },
    currentPairKey(): string {
      const pages = this.currentSpread?.pages || [];
      return pages.length === 2 ? pages.map((page) => page.index).join(":") : "";
    },
    currentPairMerged(): boolean {
      return Boolean(this.currentPairKey && this.mergedPairs[this.currentPairKey]);
    },
    progress(): number {
      return this.spreads.length <= 1
        ? 0
        : (this.spreadIndex / (this.spreads.length - 1)) * 100;
    },
  },
  actions: {
    async open(gallery: EhGallerySummary): Promise<void> {
      this.gallery = gallery;
      this.loading = true;
      this.error = "";
      this.spreadIndex = 0;
      this.mergedPairs = {};
      this.toolsVisible = false;
      const generation = ++this.loadGeneration;
      useNavigationStore().showPage("page-eh-reader");
      try {
        this.pages = await ehApi.getPages(gallery.gid);
        if (generation !== this.loadGeneration) return;
        this.imageCache = {};
        await this.loadSpreadImages(this.spreadIndex, generation);
        void this.prefetchNearby(this.spreadIndex, generation);
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },
    close(): void {
      this.loadGeneration += 1;
      this.toolsVisible = false;
      this.settingsVisible = false;
      useNavigationStore().showPage("page-detail");
    },
    next(): void {
      this.spreadIndex = Math.min(
        this.spreads.length - 1,
        this.spreadIndex + 1,
      );
      void this.showCurrentSpread();
    },
    previous(): void {
      this.spreadIndex = Math.max(0, this.spreadIndex - 1);
      void this.showCurrentSpread();
    },
    turnLeft(): void {
      if (this.direction === "rtl") this.next();
      else this.previous();
    },
    turnRight(): void {
      if (this.direction === "rtl") this.previous();
      else this.next();
    },
    goToSpread(index: number): void {
      this.spreadIndex = Math.max(
        0,
        Math.min(this.spreads.length - 1, Math.round(index)),
      );
      void this.showCurrentSpread();
    },
    goToPage(pageIndex: number): void {
      const target = this.spreads.findIndex((spread) =>
        spread.pages.some((page) => page.index === pageIndex),
      );
      if (target >= 0) {
        this.spreadIndex = target;
        void this.showCurrentSpread();
      }
    },
    toggleTools(): void {
      this.toolsVisible = !this.toolsVisible;
      if (!this.toolsVisible) this.settingsVisible = false;
    },
    setPageMode(mode: EhPageMode): void {
      const page = this.currentSpread?.startIndex || 0;
      this.pageMode = mode;
      this.goToPage(page);
    },
    togglePairing(): void {
      const page = this.currentSpread?.startIndex || 0;
      this.pairOffset = this.pairOffset === 0 ? 1 : 0;
      this.goToPage(page);
    },
    toggleCurrentPairMerge(): void {
      const key = this.currentPairKey;
      if (!key) return;
      this.mergedPairs = {
        ...this.mergedPairs,
        [key]: !this.mergedPairs[key],
      };
    },
    imageUrl(path: string): string {
      return this.imageCache[path] || "";
    },
    recordPageDimensions(index: number, width: number, height: number): void {
      if (!width || !height) return;
      const page = this.pages[index];
      if (!page || (page.width === width && page.height === height)) return;
      const currentPage = this.currentSpread?.startIndex || 0;
      this.pages = this.pages.map((item) =>
        item.index === index ? { ...item, width, height } : item,
      );
      const target = this.spreads.findIndex((spread) =>
        spread.pages.some((item) => item.index === currentPage),
      );
      if (target >= 0) this.spreadIndex = target;
    },
    async loadPaths(paths: string[], generation: number): Promise<void> {
      const missing = [...new Set(paths)].filter((path) => path && !this.imageCache[path]);
      if (!missing.length) return;
      const loaded = await mediaApi.loadImages(missing);
      if (generation !== this.loadGeneration) return;
      this.imageCache = { ...this.imageCache, ...Object.fromEntries(loaded) };
    },
    async loadSpreadImages(index: number, generation: number): Promise<void> {
      const spread = this.spreads[index];
      if (spread) await this.loadPaths(spread.pages.map((page) => page.path), generation);
    },
    async prefetchNearby(index: number, generation: number): Promise<void> {
      const nearby = [index - 1, index + 1, index + 2]
        .flatMap((spreadIndex) => this.spreads[spreadIndex]?.pages || [])
        .map((page) => page.path);
      try {
        await this.loadPaths(nearby, generation);
        if (generation !== this.loadGeneration || index !== this.spreadIndex) return;
        const retained = new Set(
          [index - 2, index - 1, index, index + 1, index + 2]
            .flatMap((spreadIndex) => this.spreads[spreadIndex]?.pages || [])
            .map((page) => page.path),
        );
        this.imageCache = Object.fromEntries(
          Object.entries(this.imageCache).filter(([path]) => retained.has(path)),
        );
      } catch {
        // Prefetch failure must not interrupt the currently visible spread.
      }
    },
    async showCurrentSpread(): Promise<void> {
      const generation = this.loadGeneration;
      try {
        await this.loadSpreadImages(this.spreadIndex, generation);
        void this.prefetchNearby(this.spreadIndex, generation);
      } catch (error) {
        if (generation === this.loadGeneration) {
          this.error = error instanceof Error ? error.message : String(error);
        }
      }
    },
  },
});
