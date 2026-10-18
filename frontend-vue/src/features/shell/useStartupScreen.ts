import { nextTick, onScopeDispose, ref, watch } from 'vue';
import { useHomeStore } from '../../stores/home';
import { useLibraryStore } from '../../stores/library';
import { useEhLibraryStore } from '../../stores/ehLibrary';
import { decodeDrawImages, prepareDrawImages } from '../home/images';
import dayBack from '../../assets/home/card-back-day.png';
import nightBack from '../../assets/home/card-back-night.png';

export interface StartupScreenHooks {
  prepare(): Promise<void>;
  finish(): void;
}

/** 开屏准备图片；原有首次翻牌暂停在起点，进入首页才继续播放。 */
export function useStartupScreen() {
  const visible = ref(true);
  const drawsHeld = ref(true);
  const media = useLibraryStore();
  const books = useEhLibraryStore();
  const home = useHomeStore();
  const cancellation = new AbortController();
  let stopPrefetch: (() => void) | undefined;
  // 后端无响应也必须能进入界面操作；正常成功/失败走各自实际完成信号。
  const deadline = setTimeout(finish, 30_000);

  function finish(): void {
    clearTimeout(deadline);
    cancellation.abort();
    visible.value = false;
  }

  async function prepare(): Promise<void> {
    if (cancellation.signal.aborted) return;
    await nextTick();
    if (cancellation.signal.aborted) return;
    home.ensureSelections(prepareDrawImages);
    const draws = new Promise<void>(resolve => {
      let stop: (() => void) | undefined;
      const done = () => { stop?.(); cancellation.signal.removeEventListener('abort', done); resolve(); };
      stop = watch(() => [home.media.loading, home.book.loading],
        () => { if (!home.media.loading && !home.book.loading) done(); });
      cancellation.signal.addEventListener('abort', done, { once: true });
      if (!home.media.loading && !home.book.loading) done();
    });
    // 请求层已合并同路径并发；这里只解码本页，不等待全库预取。
    const mediaCovers = media.loadVisibleCovers().then(() => decodeDrawImages(
      media.pagedWorks.map(work => media.coverUrl(work.cover_path)),
    ));
    const bookCovers = books.loadVisibleCovers().then(() => decodeDrawImages(
      books.pagedGalleries.map(gallery => books.coverUrl(gallery.cover_path)),
    ));
    await Promise.race([
      Promise.allSettled([draws, mediaCovers, bookCovers, decodeDrawImages([dayBack, nightBack])]).then(async () => {
        if (cancellation.signal.aborted) return;
        await nextTick();
        // 图片就绪后给真实卡片 DOM 两帧排版/合成准备时间，不创建额外截图或缓存。
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }),
      new Promise<void>(resolve => {
        if (cancellation.signal.aborted) resolve();
        else cancellation.signal.addEventListener('abort', () => resolve(), { once: true });
      }),
    ]);
  }

  function reveal(): void {
    drawsHeld.value = false;
    // 首次翻牌结束再做全库后台预取，避免解码/回包与可见动画争抢主线程。
    const idle = () => !home.media.loading && home.media.phase === 'idle' && !home.book.loading && home.book.phase === 'idle';
    const prefetch = () => { stopPrefetch?.(); stopPrefetch = undefined; void media.prefetchCovers().catch(() => undefined); };
    if (idle()) prefetch();
    else stopPrefetch = watch(idle, ready => { if (ready) prefetch(); });
  }

  onScopeDispose(() => { finish(); stopPrefetch?.(); });
  return { visible, drawsHeld, prepare, finish, reveal };
}
