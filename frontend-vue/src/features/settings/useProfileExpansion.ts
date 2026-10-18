import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

interface Elements {
  avatar: Ref<HTMLElement | null>; visual: Ref<HTMLElement | null>; summary: Ref<HTMLElement | null>;
  divider: Ref<HTMLElement | null>; flow: () => HTMLElement | null | undefined;
}
/** 先完成最终排版，再用局部反向位移补回原画面；动画期间仅由合成器移动。 */
export function useProfileExpansion(elements: Elements) {
  const expanded = ref(false), animating = ref(false);
  const phase = ref<'collapsed' | 'expanding' | 'expanded' | 'collapsing'>('collapsed');
  let motions: Animation[] = [], revision = 0;
  function reset(): void {
    revision++; motions.forEach(animation => animation.cancel()); motions = [];
    expanded.value = false; animating.value = false; phase.value = 'collapsed';
  }
  async function setExpanded(value: boolean): Promise<void> {
    if (expanded.value === value) return;
    const visual = elements.visual.value, avatar = elements.avatar.value;
    if (!visual || !avatar) return;
    const from = visual.getBoundingClientRect();
    const siblings = [elements.summary.value, elements.divider.value, elements.flow()].filter((element): element is HTMLElement => !!element);
    const before = siblings.map(element => element.getBoundingClientRect());
    const request = ++revision;
    expanded.value = value; animating.value = true; phase.value = value ? 'expanding' : 'collapsing';
    await nextTick(); if (request !== revision) return;
    motions.forEach(animation => animation.cancel()); motions = [];
    const to = avatar.getBoundingClientRect(), texture = visual.offsetWidth;
    const options: KeyframeAnimationOptions = { duration: 520, easing: 'cubic-bezier(.32,0,.2,1)', fill: 'both' };
    const pose = (x: number, y: number, scale: number) => `translate3d(${x}px,${y}px,0) scale(${scale})`;
    motions.push(visual.animate([
      { transform: pose(from.x - to.x, from.y - to.y, from.width / texture) },
      { transform: pose(0, 0, to.width / texture) },
    ], options));
    siblings.forEach((element, index) => {
      const end = element.getBoundingClientRect(), start = before[index]!;
      motions.push(element.animate([
        { transform: `translate3d(${start.x - end.x}px,${start.y - end.y}px,0)` },
        { transform: 'translate3d(0,0,0)' },
      ], options));
    });
    try { await Promise.all(motions.map(animation => animation.finished)); }
    catch { return; }
    if (request !== revision) return;
    motions.forEach(animation => animation.cancel()); motions = [];
    animating.value = false; phase.value = value ? 'expanded' : 'collapsed';
  }
  onMounted(() => window.addEventListener('resize', reset));
  onBeforeUnmount(() => { window.removeEventListener('resize', reset); reset(); });
  return { expanded, animating, phase, setExpanded, reset };
}
