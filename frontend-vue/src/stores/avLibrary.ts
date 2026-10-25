import { defineStore } from 'pinia';
import { accountScope } from '../api/accountContext';
import { avApi } from '../api/commands/av';
import { mediaApi } from '../api/commands/media';
import type { AvActress, AvWork } from '../api/contracts/av';
import { type DetailReturnPage, useNavigationStore } from './navigation';

export type AvFilterKey = 'year' | 'studio' | 'series' | 'tag';
export type AvViewMode = 'code' | 'actress';
export type AvSort = 'time-desc' | 'time-asc' | 'name-asc' | 'name-desc';
export const avFilterLabels: Record<AvFilterKey, string> = { year: '发行时间', studio: '片商', series: '系列', tag: 'Tag' };
export interface AvActressCard extends AvActress { codes: string[]; latestRelease: string }

const values = (work: AvWork, key: AvFilterKey): string[] => key === 'year'
  ? [work.release_date.slice(0, 4)] : key === 'tag' ? work.tags : [work[key]];
const text = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase();

export const useAvLibraryStore = defineStore('avLibrary', {
  state: () => ({
    works: [] as AvWork[], mode: 'code' as AvViewMode, search: '',
    activeFilters: {} as Partial<Record<AvFilterKey, string[]>>, openDropdown: null as AvFilterKey | null,
    currentSort: 'time-desc' as AvSort, codePage: 1, actressPage: 1, pageSize: 20,
    loading: false, loaded: false, error: '', requestRevision: 0,
    coverCache: {} as Record<string, string>, imageRevision: 0,
    currentWork: null as AvWork | null,
  }),
  getters: {
    filteredWorks(state): AvWork[] {
      const keyword = text(state.search);
      return state.works.filter(work => Object.entries(state.activeFilters).every(([key, selected]) =>
        !selected?.length || selected.some(value => values(work, key as AvFilterKey).includes(value))))
        .filter(work => !keyword || [work.code, work.title, work.release_date, work.studio, work.series,
          ...work.tags, ...work.actresses.flatMap(actor => [actor.name, ...actor.aliases])].some(value => text(value).includes(keyword)))
        .sort((a, b) => state.currentSort.startsWith('name')
          ? (a.code.localeCompare(b.code, undefined, { numeric: true }) * (state.currentSort === 'name-desc' ? -1 : 1))
          : (a.release_date.localeCompare(b.release_date) * (state.currentSort === 'time-desc' ? -1 : 1)) || a.code.localeCompare(b.code));
    },
    actressCards(state): AvActressCard[] {
      const grouped = new Map<string, AvActressCard>();
      const keyword = text(state.search);
      for (const work of this.filteredWorks) {
        // 搜女优名时只显示该人物，不能把同一作品中的合演者误当搜索结果。
        const named = keyword && work.actresses.some(actor => [actor.name, ...actor.aliases].some(value => text(value).includes(keyword)));
        for (const actor of work.actresses) {
          if (named && ![actor.name, ...actor.aliases].some(value => text(value).includes(keyword))) continue;
          const id = actor.id || text(actor.name);
          const card = grouped.get(id);
          if (card) {
            if (!card.codes.includes(work.code)) card.codes.push(work.code);
            if (!card.photo && actor.photo) card.photo = actor.photo;
            if (work.release_date > card.latestRelease) card.latestRelease = work.release_date;
          } else grouped.set(id, { ...actor, id, codes: [work.code], latestRelease: work.release_date });
        }
      }
      return [...grouped.values()].sort((a, b) => state.currentSort.startsWith('name')
        ? a.name.localeCompare(b.name, 'ja') * (state.currentSort === 'name-desc' ? -1 : 1)
        : a.latestRelease.localeCompare(b.latestRelease) * (state.currentSort === 'time-desc' ? -1 : 1) || a.name.localeCompare(b.name, 'ja'));
    },
    totalCount(): number { return this.mode === 'code' ? this.filteredWorks.length : this.actressCards.length; },
    currentPage(): number { return this.mode === 'code' ? this.codePage : this.actressPage; },
    totalPages(): number { return Math.max(1, Math.ceil(this.totalCount / this.pageSize)); },
    pagedWorks(): AvWork[] { return this.filteredWorks.slice((this.currentPage - 1) * this.pageSize, this.currentPage * this.pageSize); },
    pagedActresses(): AvActressCard[] { return this.actressCards.slice((this.currentPage - 1) * this.pageSize, this.currentPage * this.pageSize); },
    showClearButton(state): boolean { return !!state.search.trim() || Object.values(state.activeFilters).some(items => items?.length); },
  },
  actions: {
    async load(): Promise<void> {
      const owner = accountScope(), revision = ++this.requestRevision;
      this.loading = true; this.error = '';
      try {
        const works = await avApi.listWorks();
        if (owner !== accountScope() || revision !== this.requestRevision) return;
        this.works = works; this.loaded = true; this.clampPages();
      } catch (error) {
        if (owner === accountScope() && revision === this.requestRevision) this.error = String(error);
      } finally { if (revision === this.requestRevision) this.loading = false; }
    },
    resetSession(): void { this.requestRevision++; this.imageRevision++; this.works = []; this.currentWork = null; this.coverCache = {}; this.loaded = false; this.loading = false; this.error = ''; this.clearSearchAndFilters(); },
    upsert(work: AvWork, invalidateImages = true): void {
      if (!invalidateImages) work = { ...work, videos: this.works.find(item => item.code === work.code)?.videos || work.videos };
      if (invalidateImages) {
        this.imageRevision++;
        for (const path of [work.cover, ...work.previews, ...work.actresses.map(actor => actor.photo)]) delete this.coverCache[path];
      }
      this.works = [work, ...this.works.filter(item => item.code !== work.code)];
      if (this.currentWork?.code === work.code) this.currentWork = work;
      this.loaded = true; this.clampPages();
    },
    showDetail(work: AvWork, returnPage: DetailReturnPage): void {
      this.currentWork = work;
      const navigation = useNavigationStore(); navigation.detailSource = 'av'; navigation.showPage('page-detail', returnPage);
      void this.loadImages([work.cover]);
      void this.refreshVideos(work.code);
    },
    async refreshVideos(code: string): Promise<void> {
      const owner = accountScope(), revision = this.requestRevision;
      try {
        const videos = await avApi.localVideos(code);
        if (owner !== accountScope() || revision !== this.requestRevision) return;
        const work = this.works.find(item => item.code === code);
        if (work) work.videos = videos;
        if (this.currentWork?.code === code) this.currentWork.videos = videos;
      } catch { /* 保留已知播放入口；下次进入作品或列表会重新核对本地文件。 */ }
    },
    jumpToFilter(key: AvFilterKey, value: string): void {
      this.search = ''; this.activeFilters = { [key]: [value] }; this.mode = 'code'; this.resetPages();
      useNavigationStore().showPage('page-av-library');
    },
    toggleMode(): void { this.mode = this.mode === 'code' ? 'actress' : 'code'; this.closeDropdown(); this.clampPages(); },
    options(key: AvFilterKey): string[] { return [...new Set(this.works.flatMap(work => values(work, key)).filter(Boolean))].sort((a, b) => key === 'year' ? b.localeCompare(a) : a.localeCompare(b, 'zh-CN')); },
    toggleDropdown(key: AvFilterKey): void { this.openDropdown = this.openDropdown === key ? null : key; },
    closeDropdown(): void { this.openDropdown = null; },
    isFilterActive(key: AvFilterKey): boolean { return !!this.activeFilters[key]?.length; },
    isSelected(key: AvFilterKey, value: string): boolean { return !!this.activeFilters[key]?.includes(value); },
    toggleFilter(key: AvFilterKey, value: string): void {
      const items = this.activeFilters[key] || [];
      this.activeFilters[key] = items.includes(value) ? items.filter(item => item !== value) : [...items, value];
      this.resetPages();
    },
    clearFilter(key: AvFilterKey): void { delete this.activeFilters[key]; this.resetPages(); },
    clearSearchAndFilters(): void { this.search = ''; this.activeFilters = {}; this.closeDropdown(); this.resetPages(); },
    resetPages(): void { this.codePage = 1; this.actressPage = 1; },
    clampPages(): void {
      this.codePage = Math.max(1, Math.min(this.codePage, Math.ceil(this.filteredWorks.length / this.pageSize) || 1));
      this.actressPage = Math.max(1, Math.min(this.actressPage, Math.ceil(this.actressCards.length / this.pageSize) || 1));
    },
    updatePageSize(size: number): void { this.pageSize = Math.max(1, size); this.clampPages(); },
    goPage(page: number): void { const next = Math.max(1, Math.min(this.totalPages, Math.floor(page) || 1)); if (this.mode === 'code') this.codePage = next; else this.actressPage = next; },
    toggleTimeSort(): void { this.currentSort = this.currentSort === 'time-desc' ? 'time-asc' : 'time-desc'; this.resetPages(); },
    toggleNameSort(): void { this.currentSort = this.currentSort === 'name-asc' ? 'name-desc' : 'name-asc'; this.resetPages(); },
    imageUrl(path: string): string { return path.startsWith('data:image/') ? path : this.coverCache[path] || ''; },
    async loadVisibleImages(): Promise<void> {
      await this.loadImages(this.mode === 'code' ? this.pagedWorks.map(work => work.cover) : this.pagedActresses.map(actor => actor.photo));
    },
    async loadImages(requested: string[]): Promise<void> {
      const paths = [...new Set(requested.filter(path => path && !this.imageUrl(path)))];
      if (!paths.length) return;
      const revision = this.imageRevision, owner = accountScope();
      try {
        const loaded = await mediaApi.loadImages(paths);
        if (revision === this.imageRevision && owner === accountScope()) Object.assign(this.coverCache, Object.fromEntries(loaded));
      } catch { /* 图片失败仍显示原尺寸占位，不影响筛选。 */ }
    },
  },
});
