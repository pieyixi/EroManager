import { onScopeDispose, shallowRef, watch, type Ref } from 'vue';

/** 以数字本身定轴；单位只占右侧安全空间，不参与数字和说明的居中。 */
export function useMetricAlignment(row: Ref<HTMLElement | null>) {
  const style = shallowRef({ '--metric-start': '40px', '--metric-end': '40px' });
  let observer: ResizeObserver | undefined;
  watch(row, element => {
    observer?.disconnect();
    if (!element) return;
    const cells = [...element.children] as HTMLElement[];
    const parts = cells.map(cell => {
      const heading = cell.children[0] as HTMLElement;
      return { number: heading.children[0] as HTMLElement,
        unit: heading.children[1] as HTMLElement | undefined, label: cell.children[1] as HTMLElement };
    });
    const measure = () => {
      const first = parts[0], last = parts[parts.length - 1];
      if (!first || !last) return;
      // offsetWidth 不受弹窗入场 scale 影响；边缘遵循已有的卡片内容线。
      const start = Math.max(first.number.offsetWidth, first.label.offsetWidth) / 2;
      const end = Math.max(last.number.offsetWidth / 2 + (last.unit ? last.unit.offsetWidth + 2 : 0), last.label.offsetWidth / 2);
      const next = { '--metric-start': `${start}px`, '--metric-end': `${end}px` };
      if (next['--metric-start'] !== style.value['--metric-start'] || next['--metric-end'] !== style.value['--metric-end']) style.value = next;
    };
    measure();
    observer = new ResizeObserver(measure);
    for (const part of parts) for (const node of [part.number, part.unit, part.label]) if (node) observer.observe(node);
  }, { flush: 'post' });
  onScopeDispose(() => observer?.disconnect());
  return style;
}
