import { computed, nextTick, onBeforeUnmount, shallowRef, watch, type Ref } from 'vue';
import type { HandCard } from '../../stores/homeHand';

export interface HandLayoutItem {
  card: HandCard;
  index: number;
  virtual: number;
  distance: number;
  rank: number;
  key: string;
}
interface Pose {
  x: number; y: number; width: number; height: number;
  angle: number; scale: number; layer: number;
}
const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
const gentleEase = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** 展开和收拢共享实体牌及屏幕坐标，新增牌从主牌下面出发，收回后才回收节点。 */
export function useHandLayout(options: {
  root: Ref<HTMLElement | null>;
  expanded: Ref<boolean>;
  active: () => boolean;
  target: () => HandLayoutItem[];
  mainKey: () => string | undefined;
  prepareClose: () => void;
}) {
  const changing = shallowRef(false);
  const retained = shallowRef<HandLayoutItem[]>([]);
  const poses = shallowRef(new Map<string, Pose>());
  const elements = new Map<string, { element: HTMLElement; item: HandLayoutItem }>();
  let frame = 0;
  let revision = 0;
  let bounds: DOMRect | undefined;
  const cards = computed(() => changing.value ? retained.value : options.target());

  function remember(element: unknown, item: HandLayoutItem): void {
    if (element instanceof HTMLElement) elements.set(item.key, { element, item });
    else elements.delete(item.key);
  }

  function capture(element: HTMLElement, root: DOMRect): Pose {
    const css = getComputedStyle(element);
    const base = new DOMMatrixReadOnly(css.transform === 'none' ? undefined : css.transform);
    const matrix = new DOMMatrix().rotate(Number.parseFloat(css.rotate) || 0)
      .scale(Number.parseFloat(css.scale) || 1).multiply(base);
    const [ox, oy] = css.transformOrigin.split(' ').map(Number.parseFloat);
    return {
      x: root.left + Number.parseFloat(css.left) + (ox || 0) + matrix.e,
      y: root.top + Number.parseFloat(css.top) + (oy || 0) + matrix.f,
      width: Number.parseFloat(css.width), height: Number.parseFloat(css.height),
      angle: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
      scale: Math.hypot(matrix.a, matrix.b), layer: Number(css.zIndex) || 1,
    };
  }

  function finish(): void {
    revision++;
    cancelAnimationFrame(frame);
    frame = 0;
    changing.value = false;
    retained.value = [];
    poses.value = new Map();
    bounds = undefined;
  }

  function style(key: string): Record<string, string | number> {
    const pose = poses.value.get(key);
    if (!pose || !bounds || !changing.value) return {};
    return {
      left: `${pose.x - bounds.left}px`, top: `${pose.y - bounds.top - pose.height}px`, bottom: 'auto',
      width: `${pose.width}px`, height: `${pose.height}px`,
      transform: `translateX(-50%) rotate(${pose.angle}deg) scale(${pose.scale})`,
      zIndex: pose.layer,
    };
  }

  watch(options.expanded, async (opening) => {
    const root = options.root.value;
    if (!root || !options.active() || !options.target().length) { finish(); return; }
    const ticket = ++revision;
    cancelAnimationFrame(frame);
    if (!opening) options.prepareClose();
    const oldBounds = root.getBoundingClientRect();
    const old = new Map([...elements].map(([key, entry]) => [key, { item: entry.item, pose: capture(entry.element, oldBounds) }]));
    const mainKey = options.mainKey();
    const sourceMain = old.get(mainKey || '')?.pose || old.values().next().value?.pose;
    if (!sourceMain) { finish(); return; }
    const targets = options.target();
    const targetKeys = new Set(targets.map(item => item.key));
    retained.value = [...targets, ...[...old.values()].filter(entry => !targetKeys.has(entry.item.key))
      .map((entry, index) => ({ ...entry.item, distance: 2, rank: -index - 1 }))];
    changing.value = true;
    poses.value = new Map();
    // 此处只测量新布局，浏览器绘制前立即回填旧坐标，杜绝先闪到终点再开始动画。
    await nextTick();
    if (ticket !== revision) return;
    bounds = root.getBoundingClientRect();
    const targetPoses = new Map([...elements].map(([key, entry]) => [key, capture(entry.element, bounds!)]));
    const sourcePoses = new Map(retained.value.map(item => {
      const source = old.get(item.key)?.pose || {
        ...sourceMain, x: sourceMain.x - (opening ? 4 : 0), y: sourceMain.y - (opening ? 3 : 10),
        angle: opening ? sourceMain.angle : 0, scale: opening ? sourceMain.scale : .45, layer: 0,
      };
      return [item.key, source] as const;
    }));
    const oldLayers = [...old.values()].map(entry => entry.pose.layer).sort((a, b) => a - b);
    const mappedLayer = (layer: number) => 40 + oldLayers.indexOf(layer);
    const landing = targetPoses.get(mainKey || '')!;
    const interpolate = (from: Pose, to: Pose, t: number, lift: number): Pose => {
      const mix = (a: number, b: number) => a + (b - a) * t;
      return {
        x: mix(from.x, to.x), y: mix(from.y, to.y) - Math.sin(Math.PI * t) * lift,
        width: mix(from.width, to.width), height: mix(from.height, to.height),
        angle: mix(from.angle, to.angle), scale: mix(from.scale, to.scale), layer: to.layer,
      };
    };
    const paint = (progress: number) => {
      const next = new Map<string, Pose>();
      const elapsed = progress * (opening ? 640 : 1000);
      const gather = Math.min(1, elapsed / 600);
      const stackMain = interpolate(sourceMain, landing, ease((gather - .2) / .8), 12);
      for (const item of retained.value) {
        const from = sourcePoses.get(item.key)!;
        const to = targetPoses.get(item.key)!;
        const main = item.key === mainKey;
        let pose: Pose;
        if (opening) {
          pose = interpolate(from, to, ease(main ? progress / .76 : (progress - .18) / .82), main ? 12 : 7);
          pose.layer = main ? 100 : progress < .18 ? mappedLayer(from.layer) : to.layer;
        } else if (elapsed < 600) {
          // 先全部对齐。新补入的背牌始终跟在主牌下面，不能提前露出七张散牌。
          pose = main ? stackMain : old.has(item.key)
            ? interpolate(from, landing, ease(gather / .72), 7)
            : { ...stackMain, scale: stackMain.scale * .9 };
          pose.layer = main ? 100 : gather < .72 ? from.layer : 20 + to.layer;
        } else {
          // 到位后再微错开；不属于最终七张背牌的临时层始终保持整齐隐藏。
          pose = interpolate(landing, targetKeys.has(item.key) ? to : landing, gentleEase((elapsed - 660) / 340), 0);
          pose.layer = main ? 100 : targetKeys.has(item.key) ? 20 + to.layer : 1;
        }
        next.set(item.key, pose);
      }
      poses.value = next;
    };
    paint(0);
    const start = performance.now();
    const duration = opening ? 640 : 1000;
    const complete = async () => {
      // 先在禁用 CSS 过渡的这一帧交还定位，下一帧才恢复常规样式。
      // 否则 left/top 已还原，transform 却又补间一次，背牌就会回跳再二次错开。
      retained.value = options.target();
      poses.value = new Map();
      bounds = undefined;
      await nextTick();
      if (ticket !== revision) return;
      frame = requestAnimationFrame(() => { if (ticket === revision) finish(); });
    };
    const tick = (now: number) => {
      if (ticket !== revision) return;
      const progress = Math.min(1, (now - start) / duration);
      paint(progress);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else void complete();
    };
    frame = requestAnimationFrame(tick);
  }, { flush: 'sync' });
  watch(options.active, active => { if (!active) finish(); });
  watch(() => options.target().length, count => { if (!count) finish(); });
  onBeforeUnmount(() => { finish(); elements.clear(); });
  return { changing, cards, remember, style };
}
