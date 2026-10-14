import { onBeforeUnmount, ref } from 'vue';

/** 单一连续坐标驱动每张牌绕行的位置、大小和前后层级，不移动整副牌的容器。 */
export function useHandCarousel(initial: number) {
  const position = ref(initial);
  const moving = ref(false);
  let frame = 0;
  let destination = initial;

  function stop(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    moving.value = false;
  }
  function seek(value: number): void {
    stop();
    position.value = destination = value;
  }
  function settle(value: number, complete: () => void): void {
    stop();
    const from = position.value;
    const distance = Math.abs(value - from);
    destination = value;
    if (distance < .001) { position.value = value; complete(); return; }
    const duration = Math.min(640, Math.max(300, 560 * Math.sqrt(distance)));
    const start = performance.now();
    moving.value = true;
    function tick(now: number): void {
      const progress = Math.max(0, Math.min(1, (now - start) / duration));
      position.value = from + (value - from) * (1 - (1 - progress) ** 3);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else { frame = 0; moving.value = false; position.value = value; complete(); }
    }
    frame = requestAnimationFrame(tick);
  }
  onBeforeUnmount(stop);
  return { position, moving, stop, seek, settle, target: () => destination };
}
