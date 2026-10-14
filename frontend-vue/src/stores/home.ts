import { defineStore } from 'pinia';
import { libraryApi } from '../api/commands/library';
import { ehApi } from '../api/commands/eh';
import { mediaApi } from '../api/commands/media';
import { createDrawPool, pickNext, recordDraw, sampleItems, type DrawPool } from '../features/home/random';
import { useLibraryStore } from './library';
import { useEhLibraryStore } from './ehLibrary';
import { useNavigationStore } from './navigation';

export type DrawSource = 'media' | 'book';
export type DrawPhase = 'idle' | 'closing' | 'tucking' | 'waiting' | 'opening' | 'settling';
export interface DrawPreview { key: string; label: string; image: string }
export interface DrawSelection { id: number; title: string; cover: string; previews: DrawPreview[] }
interface DrawLane {
  pool: DrawPool;
  current: DrawSelection | null;
  staged: DrawSelection | null;
  retiring: DrawSelection | null;
  phase: DrawPhase;
  loading: boolean;
  openingDetail: boolean;
  error: string;
  request: number;
}

function lane(): DrawLane {
  return { pool: createDrawPool(), current: null, staged: null, retiring: null, phase: 'idle', loading: false, openingDetail: false, error: '', request: 0 };
}
export function drawBusy(value: DrawLane): boolean {
  return value.loading || value.openingDetail || value.phase !== 'idle';
}

export const useHomeStore = defineStore('home', {
  state: () => ({ media: lane(), book: lane() }),
  actions: {
    async draw(source: DrawSource, prepare?: (selection: DrawSelection) => Promise<void>): Promise<void> {
      const state = this[source];
      if (drawBusy(state)) return;
      state.loading = true;
      state.error = '';
      state.retiring = state.current;
      state.phase = state.current ? 'closing' : 'waiting';
      const request = ++state.request;
      try {
        const next = source === 'media' ? await this.pickMedia() : await this.pickBook();
        if (request !== state.request) return;
        if (next && prepare) await prepare(next);
        if (request !== state.request) return;
        state.staged = next;
      } catch (error) {
        if (request !== state.request) return;
        state.error = `抽取失败：${error instanceof Error ? error.message : String(error)}`;
      } finally {
        if (request === state.request) {
          state.loading = false;
          this.reveal(source);
        }
      }
    },
    async pickMedia(): Promise<DrawSelection | null> {
      const library = useLibraryStore();
      if (!library.works.length && library.error) await library.initialize();
      if (library.error) throw new Error(library.error);
      const work = pickNext(library.works, this.media.pool, (item) => item.id, this.media.current?.id);
      if (!work) return null;
      // 抽卡只读取详情，不改正在浏览的详情、筛选、页码或播放器状态。
      const detail = await libraryApi.getWorkDetail(work.id);
      const episodes = sampleItems(detail.episodes, 3).sort((a, b) => (a.number ?? a.id) - (b.number ?? b.id));
      const paths = [work.cover_path, ...episodes.map((item) => item.cover_path)].filter((path): path is string => Boolean(path));
      const images = Object.fromEntries(await mediaApi.loadImages([...new Set(paths)]));
      return {
        id: work.id, title: work.title, cover: images[work.cover_path || ''] || '',
        previews: episodes.map((item) => ({ key: String(item.id), label: `第 ${item.number ?? item.id} 集`, image: images[item.cover_path || ''] || '' })),
      };
    },
    async pickBook(): Promise<DrawSelection | null> {
      const library = useEhLibraryStore();
      if (!library.galleries.length && library.error) await library.load();
      if (library.error) throw new Error(library.error);
      const gallery = pickNext(library.galleries, this.book.pool, (item) => item.gid, this.book.current?.id);
      if (!gallery) return null;
      const pages = sampleItems(await ehApi.getPages(gallery.gid), 3).sort((a, b) => a.index - b.index);
      const paths = [gallery.cover_path, ...pages.map((item) => item.path)].filter(Boolean);
      // 内页图片仅存当前抽卡，不进入全库封面缓存，内存不随抽卡次数增长。
      const images = Object.fromEntries(await mediaApi.loadImages([...new Set(paths)]));
      return {
        id: gallery.gid, title: gallery.title, cover: images[gallery.cover_path] || '',
        previews: pages.map((item) => ({ key: item.path, label: `第 ${item.index + 1} 页`, image: images[item.path] || '' })),
      };
    },
    reveal(source: DrawSource): void {
      const state = this[source];
      if (state.loading || state.phase !== 'waiting') return;
      const candidate = state.staged;
      const exists = candidate && (source === 'media'
        ? useLibraryStore().works.some((item) => item.id === candidate.id)
        : useEhLibraryStore().galleries.some((item) => item.gid === candidate.id));
      if (exists) {
        state.current = candidate;
        recordDraw(state.pool, source === 'media'
          ? useLibraryStore().works.map((item) => item.id)
          : useEhLibraryStore().galleries.map((item) => item.gid), candidate.id);
      }
      state.staged = null;
      state.phase = state.current ? 'opening' : 'idle';
    },
    finishAnimation(source: DrawSource, expectedPhase?: DrawPhase): void {
      const state = this[source];
      if (expectedPhase && state.phase !== expectedPhase) return;
      if (state.phase === 'closing') {
        state.phase = 'tucking';
      } else if (state.phase === 'tucking') {
        state.phase = 'waiting';
        this.reveal(source);
      } else if (state.phase === 'opening') {
        state.phase = 'settling';
      } else if (state.phase === 'settling') {
        state.phase = 'idle';
        state.retiring = null;
      }
    },
    ensureSelections(prepare?: (selection: DrawSelection) => Promise<void>): void {
      const library = useLibraryStore();
      const books = useEhLibraryStore();
      const sources: Array<[DrawSource, number[], boolean]> = [
        ['media', library.works.map((item) => item.id), library.loading],
        ['book', books.galleries.map((item) => item.gid), books.loading],
      ];
      for (const [source, ids, loading] of sources) {
        const state = this[source];
        if (loading) continue;
        if (state.current && !ids.includes(state.current.id)) {
          state.request += 1;
          state.staged = null;
          state.retiring = null;
          state.loading = false;
          state.phase = 'idle';
          state.current = null;
        }
        if (drawBusy(state)) continue;
        if (!state.current && ids.length) void this.draw(source, prepare);
      }
    },
    cancelDraws(): void {
      // 隐藏页不会触发 animationend；离开时废弃请求并解除锁，保留已展示作品。
      for (const state of [this.media, this.book]) {
        state.request += 1;
        state.staged = null;
        state.retiring = null;
        state.loading = false;
        state.phase = 'idle';
      }
    },
    async openDetail(source: DrawSource, selectedId?: number): Promise<void> {
      const state = this[source];
      const id = selectedId ?? state.current?.id;
      if (id === undefined || state.openingDetail || (selectedId === undefined && drawBusy(state))) return;
      const navigation = useNavigationStore();
      if (navigation.activePage !== 'page-home') return;
      const revision = navigation.pageRevision;
      state.openingDetail = true;
      state.error = '';
      try {
        if (source === 'media') {
          await useLibraryStore().showDetail(id, 'page-home');
          if (navigation.activePage === 'page-home' && navigation.pageRevision === revision) throw new Error('无法打开作品详情，请稍后重试');
        }
        else {
          const library = useEhLibraryStore();
          const gallery = library.galleries.find((item) => item.gid === id);
          if (!gallery) throw new Error('作品已移出本子库，请重新抽取');
          // 随机作品可能不在库当前页；详情使用库封面缓存，必须单独补载。
          await library.loadCovers([gallery.cover_path]);
          if (navigation.pageRevision !== revision) return;
          library.showDetail(gallery, 'page-home');
        }
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      } finally { state.openingDetail = false; }
    },
  },
});
