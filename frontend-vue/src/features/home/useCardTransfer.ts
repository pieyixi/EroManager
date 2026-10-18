import { computed, onBeforeUnmount, ref } from 'vue';
import type { DrawSelection, DrawSource } from '../../stores/home';

interface CardRect { left: number; top: number; width: number; height: number }
export interface HandDropTarget {
  containsPoint(x: number, y: number): boolean;
  landingRect(): CardRect | null;
}
interface Transfer {
  source: DrawSource;
  selection: DrawSelection;
  pointer: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  origin: CardRect;
  phase: 'pending' | 'dragging' | 'landing' | 'returning';
}

/** 局部 pointer capture 管理整次拖拽；不安装全局 DOM 事件，也不把几何塞进 store。 */
export function useCardTransfer(target: () => HandDropTarget | null, collect: (source: DrawSource, selection: DrawSelection) => void) {
  const transfer = ref<Transfer | null>(null);
  const overTarget = ref(false);
  let capture: HTMLElement | null = null;
  let suppressClick = false;
  let suppressedClickTarget: HTMLElement | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  function release(): void {
    const pointer = transfer.value?.pointer;
    const element = capture;
    capture = null;
    if (pointer !== undefined && element?.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
  }
  function cancel(): void {
    clearTimeout(settleTimer);
    release();
    transfer.value = null;
    overTarget.value = false;
  }
  function down(source: DrawSource, selection: DrawSelection | null, event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary || !selection || transfer.value) return;
    const element = event.currentTarget as HTMLElement;
    const rect = element.getBoundingClientRect();
    suppressClick = false;
    suppressedClickTarget = null;
    capture = element;
    element.setPointerCapture(event.pointerId);
    transfer.value = { source, selection, pointer: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: rect.left, y: rect.top, origin: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, phase: 'pending' };
  }
  function move(event: PointerEvent): void {
    const state = transfer.value;
    if (!state || state.pointer !== event.pointerId || (state.phase !== 'pending' && state.phase !== 'dragging')) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (state.phase === 'pending' && Math.hypot(dx, dy) < 8) return;
    state.phase = 'dragging';
    suppressClick = true;
    suppressedClickTarget = capture;
    state.x = state.origin.left + dx;
    state.y = state.origin.top + dy;
    overTarget.value = target()?.containsPoint(event.clientX, event.clientY) || false;
    event.preventDefault();
  }
  function finish(): void {
    clearTimeout(settleTimer);
    transfer.value = null;
    overTarget.value = false;
  }
  function up(event: PointerEvent): void {
    const state = transfer.value;
    if (!state || state.pointer !== event.pointerId) return;
    if (state.phase === 'pending') { release(); finish(); return; }
    if (state.phase !== 'dragging') return;
    const accepted = target()?.containsPoint(event.clientX, event.clientY) || false;
    const destination = accepted ? target()?.landingRect() : state.origin;
    state.phase = accepted ? 'landing' : 'returning';
    if (destination) { state.x = destination.left; state.y = destination.top; state.origin = destination; }
    release();
    if (accepted) collect(state.source, state.selection);
    settleTimer = setTimeout(finish, 360);
  }
  function lostCapture(): void {
    if (transfer.value?.phase === 'pending' || transfer.value?.phase === 'dragging') cancel();
  }
  function allowDraw(event: MouseEvent): boolean {
    if (event.detail === 0) return true;
    // 自动补抽会禁用原主牌，浏览器可能不再派发它的 click；不能因此吞掉另一侧的点击。
    const allowed = !suppressClick || event.currentTarget !== suppressedClickTarget;
    suppressClick = false;
    suppressedClickTarget = null;
    return allowed;
  }
  const ghostStyle = computed(() => {
    const state = transfer.value;
    return state ? { left: `${state.x}px`, top: `${state.y}px`, width: `${state.origin.width}px`, height: `${state.origin.height}px` } : {};
  });
  onBeforeUnmount(cancel);
  return { transfer, overTarget, ghostStyle, down, move, up, cancel, lostCapture, allowDraw };
}
