import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from 'vue';
import { useEhReaderStore } from '../../stores/ehReader';
import { useNavigationStore } from '../../stores/navigation';
import type { EhReaderPage } from '../../api/contracts/eh';

interface Frame {
  id: number;
  pages: (EhReaderPage & { src: string })[];
  merged: boolean;
}
interface PresentationRequest {
  active: boolean;
  loading: boolean;
  generation: number;
  direction: string;
  merged: boolean;
  pages: Frame['pages'];
}

// 图片解码和显示缓冲属于阅读视图，不把 DOM 对象放进共享状态。
export function useReaderPresentation() {
  const reader = useEhReaderStore();
  const navigation = useNavigationStore();
  const shown = shallowRef<Frame>();
  const pending = shallowRef<Frame>();
  const elements = new Map<number, Map<number, HTMLImageElement>>();
  const decoded = new Map<string, Promise<HTMLImageElement>>();
  let revision = 0;
  let serial = 0;
  let generation = -1;

  function prepare(src: string): Promise<HTMLImageElement> {
    let result = decoded.get(src);
    if (!result) {
      const image = new Image();
      image.src = src;
      result = image.decode().then(() => image);
      decoded.set(src, result);
      void result.catch(() => { if (decoded.get(src) === result) decoded.delete(src); });
    }
    return result;
  }

  function bindImage(frame: Frame, index: number, image: unknown): void {
    if (!(image instanceof HTMLImageElement)) return;
    let group = elements.get(frame.id);
    if (!group) elements.set(frame.id, group = new Map());
    group.set(index, image);
  }

  const request = computed<PresentationRequest>((previous) => {
    const target = {
      active: navigation.activePage === 'page-eh-reader',
      loading: reader.loading,
      generation: reader.loadGeneration,
      direction: reader.direction,
      merged: reader.currentPairMerged,
      pages: (reader.currentSpread?.pages || []).map(page => ({ ...page, src: reader.imageUrl(page.path) })),
    };
    // 邻页缓存更新不应重建当前显示，更不应复制大段图片数据来比较。
    if (previous && target.active === previous.active && target.loading === previous.loading &&
      target.generation === previous.generation && target.direction === previous.direction &&
      target.merged === previous.merged && target.pages.length === previous.pages.length &&
      target.pages.every((page, index) => {
        const old = previous.pages[index];
        return page.index === old.index && page.path === old.path && page.src === old.src &&
          page.width === old.width && page.height === old.height;
      })) return previous;
    return target;
  });

  watch(request, async (target) => {
    const ticket = ++revision;
    pending.value = undefined;
    for (const id of elements.keys()) if (id !== shown.value?.id) elements.delete(id);
    if (!target.active || generation !== target.generation) {
      shown.value = undefined;
      decoded.clear();
      elements.clear();
      generation = target.generation;
    }
    if (!target.active || target.loading || !target.pages.length || target.pages.some(page => !page.src)) return;
    const current = () => ticket === revision && navigation.activePage === 'page-eh-reader';
    try {
      const images = await Promise.all(target.pages.map(page => prepare(page.src)));
      if (!current()) return;
      // 横图识别引发的重新配对必须在上屏前完成，旧画面在此期间保持不动。
      target.pages.forEach((page, index) => {
        reader.recordPageDimensions(page.index, images[index].naturalWidth, images[index].naturalHeight);
      });
      await nextTick();
      if (!current()) return;
      const frame: Frame = {
        id: ++serial,
        pages: target.direction === 'rtl' ? [...target.pages].reverse() : target.pages,
        merged: target.merged,
      };
      pending.value = frame;
      await nextTick();
      // 等待真正将要显示的 DOM 图片解码；整组双页只提交一次。
      await Promise.all(frame.pages.map(page => {
        const image = elements.get(frame.id)?.get(page.index);
        if (!image) throw new Error('阅读页面尚未准备完成');
        return image.decode();
      }));
      if (!current()) return;
      shown.value = frame;
      pending.value = undefined;
      reader.error = '';
      await nextTick();
      for (const id of elements.keys()) if (id !== shown.value?.id) elements.delete(id);
    } catch (error) {
      if (current()) {
        pending.value = undefined;
        reader.error = error instanceof Error ? error.message : String(error);
      }
    }
  }, { immediate: true });

  // 数据预取后顺带解码，缓存仅覆盖原有的邻页窗口和当前显示页。
  watch(() => reader.imageCache, (cache) => {
    const retained = new Set(Object.values(cache));
    shown.value?.pages.forEach(page => retained.add(page.src));
    for (const src of decoded.keys()) if (!retained.has(src)) decoded.delete(src);
    if (navigation.activePage === 'page-eh-reader') {
      Object.values(cache).forEach(src => { if (src) void prepare(src).catch(() => {}); });
    }
  });

  onBeforeUnmount(() => { revision++; decoded.clear(); elements.clear(); });
  return { shown, pending, bindImage };
}
