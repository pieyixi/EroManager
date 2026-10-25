import { onBeforeUnmount, watch, type ComponentPublicInstance, type Ref } from 'vue';
import { coverFlightVisible, detailTransitionSource, registerDetailCover, type DetailCoverOrigin } from './detailTransition';

/** 各页只登记自己渲染的封面 ref；虚拟分页/记录移除时同步释放，不查询整页 DOM。 */
export function useDetailCoverTargets(viewport?: Ref<HTMLElement | null>) {
  const targets = new Map<DetailCoverOrigin, { frame: HTMLElement | null; image: HTMLImageElement | null }>();
  function set(key: DetailCoverOrigin, part: 'frame' | 'image', node: Element | ComponentPublicInstance | null): void {
    const target = targets.get(key) || { frame: null, image: null };
    if (part === 'frame') target.frame = node instanceof HTMLElement ? node : null;
    else target.image = node instanceof HTMLImageElement ? node : null;
    registerDetailCover(key, target.frame, target.image, viewport?.value || null);
    if (target.frame || target.image) targets.set(key, target); else targets.delete(key);
  }
  if (viewport) watch(viewport, element => targets.forEach((target, key) => registerDetailCover(key, target.frame, target.image, element)), { flush: 'post' });
  onBeforeUnmount(() => targets.forEach((_, key) => registerDetailCover(key, null)));
  return {
    frame: (key: DetailCoverOrigin, node: Element | ComponentPublicInstance | null) => set(key, 'frame', node),
    image: (key: DetailCoverOrigin, node: Element | ComponentPublicInstance | null) => set(key, 'image', node),
    hidden: (key: DetailCoverOrigin) => detailTransitionSource.value === key && coverFlightVisible.value,
  };
}
