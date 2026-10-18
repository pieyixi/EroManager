import { nextTick, onScopeDispose, watch, type Ref } from 'vue';

/** 先提交目标布局，再以固定纹理的位移/缩放补位，品牌与正文不逐帧改变宽高。 */
export function useAccountGateLayout(options: {
  mode: Ref<string>; visible: Ref<boolean>; brand: Ref<HTMLElement | null>; content: Ref<HTMLElement | null>; views: Ref<HTMLElement | null>[];
}): void {
  let revision = 0;
  const animations: Animation[] = [];
  function cancel(): void { revision++; for (const animation of animations) animation.cancel(); animations.length = 0; }
  const stop = watch(options.mode, async () => {
    const brand = options.brand.value, content = options.content.value;
    if (!options.visible.value || !brand || !content) return;
    const fromBrand = brand.getBoundingClientRect(), fromContent = content.getBoundingClientRect();
    const views = options.views.flatMap(view => view.value ? [{ element: view.value, opacity: getComputedStyle(view.value).opacity }] : []);
    cancel(); const request = revision;
    await nextTick();
    if (request !== revision || !options.visible.value || !brand.isConnected) return;
    const targetBrand = brand.getBoundingClientRect(), targetContent = content.getBoundingClientRect();
    // 用户明确要求此处空间连续；系统减少动效也不能跳到目标几何。
    const easing = 'cubic-bezier(.4,0,.2,1)';
    const finalScale = targetBrand.width / brand.offsetWidth;
    const flight = brand.animate([
      { transform: `translate3d(${(fromBrand.left + fromBrand.width / 2) - (targetBrand.left + targetBrand.width / 2)}px,${fromBrand.top - targetBrand.top}px,0) scale(${fromBrand.width / brand.offsetWidth})` },
      { transform: `translate3d(0,0,0) scale(${finalScale})` },
    ], { duration: 560, easing });
    const flow = content.animate([
      { transform: `translate3d(${fromContent.left - targetContent.left}px,${fromContent.top - targetContent.top}px,0)` },
      { transform: 'translate3d(0,0,0)' },
    ], { duration: 560, easing });
    animations.push(flight, flow);
    // 两个常驻面板从同一帧的实际透明度重定向，快速反向时不会卸载旧层或重复入场。
    for (const view of views) animations.push(view.element.animate([
      { opacity: view.opacity }, { opacity: getComputedStyle(view.element).opacity },
    ], { duration: 280, easing: 'linear' }));
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => { if (request === revision) cancel(); });
  }, { flush: 'pre' });
  const stopVisible = watch(options.visible, open => { if (!open) cancel(); });
  window.addEventListener('resize', cancel);
  onScopeDispose(() => { stop(); stopVisible(); cancel(); window.removeEventListener('resize', cancel); });
}
