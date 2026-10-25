import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { useHomeHandStore, type HandCard } from '../../stores/homeHand';
import { nextHandPosition, snapHandPosition, wrapHandIndex } from './handCarousel';
import { useHandCarousel } from './useHandCarousel';

interface LiftedCard {
  card: HandCard;
  left: number; top: number; width: number; height: number;
  originLeft: number; originTop: number;
  phase: 'dragging' | 'returning' | 'throwing';
}
interface Gesture {
  pointer: number; x: number; y: number; moved: boolean;
  position: number; spacing: number; lastTime: number; lastPosition: number; velocity: number;
  virtual: number | null; element: HTMLElement | null;
}

export function useHandInteraction(options: {
  root: Ref<HTMLElement | null>; expanded: Ref<boolean>;
  active: () => boolean; disabled: () => boolean; open: (card: HandCard) => void;
}) {
  const hand = useHomeHandStore();
  const carousel = useHandCarousel(hand.activeIndex);
  const dragging = ref(false);
  const pressingKey = ref<string | null>(null);
  const readyKey = ref<string | null>(null);
  const lifted = ref<LiftedCard | null>(null);
  let gesture: Gesture | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let liftTimer: ReturnType<typeof setTimeout> | undefined;
  let wheelSum = 0;
  let lastWheel = 0;
  let lastStep = -Infinity;

  function release(): Gesture | null {
    const previous = gesture;
    gesture = null;
    dragging.value = false;
    pressingKey.value = null;
    clearTimeout(holdTimer);
    if (previous && options.root.value?.hasPointerCapture(previous.pointer)) options.root.value.releasePointerCapture(previous.pointer);
    return previous;
  }
  function cancel(): void {
    release();
    wheelSum = 0; lastWheel = 0; lastStep = -Infinity;
    clearTimeout(liftTimer);
    const discarded = lifted.value?.phase === 'throwing' ? lifted.value.card.key : null;
    readyKey.value = null;
    lifted.value = null;
    // 松手丢出即确认移出；离页只结束动效，不撤销已确认的操作。
    if (discarded) hand.remove(discarded);
    carousel.seek(hand.activeIndex);
  }
  function freezeSelection(): void {
    // 收牌可以打断尚未落定的循环；提交画面中央最近的牌，不能回跳旧主牌。
    release();
    carousel.stop();
    if (hand.cards.length) hand.select(wrapHandIndex(Math.round(carousel.position.value), hand.cards.length));
  }
  function settle(virtual: number): void {
    if (hand.cards.length === 2) virtual = Math.max(0, Math.min(1, virtual));
    carousel.settle(virtual, () => hand.select(wrapHandIndex(virtual, hand.cards.length)));
  }
  function activate(virtual: number | null): void {
    if (virtual === null || options.disabled() || lifted.value) return;
    if (!options.expanded.value) { expandAt(virtual); return; }
    if (!carousel.moving.value && Math.abs(virtual - carousel.position.value) < .01) {
      // 点击可打断接近终点的轮播；必须先补交选中记录，否则画面已换牌、current 却仍是旧牌。
      carousel.seek(virtual);
      hand.select(wrapHandIndex(virtual, hand.cards.length));
      const card = hand.current;
      if (card) options.open(card);
    } else settle(virtual);
  }
  function expandAt(index: number): void {
    if (!hand.cards.length || lifted.value) return;
    release();
    carousel.seek(wrapHandIndex(index, hand.cards.length));
    hand.select(index);
    options.expanded.value = true;
  }
  function step(direction: number): void {
    if (hand.cards.length < 2 || options.disabled() || lifted.value || gesture) return;
    if (!options.expanded.value) options.expanded.value = true;
    settle(nextHandPosition(carousel.target(), direction, hand.cards.length));
  }
  function pointerDown(event: PointerEvent, virtual: number | null): void {
    if (event.button !== 0 || !event.isPrimary || options.disabled() || lifted.value || gesture) return;
    const moving = carousel.moving.value;
    carousel.stop();
    const element = event.currentTarget as HTMLElement;
    gesture = {
      pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false,
      position: carousel.position.value, spacing: Math.max(48, element.offsetWidth * .78),
      lastPosition: carousel.position.value, lastTime: event.timeStamp, velocity: 0,
      virtual, element: virtual === null ? null : element,
    };
    // 提起后原牌会隐藏，焦点需留在稳定容器，Esc 才不会落到 body 而失效。
    event.preventDefault();
    options.root.value?.focus({ preventScroll: true });
    options.root.value?.setPointerCapture(event.pointerId);
    if (options.expanded.value && !moving && virtual !== null && Math.abs(virtual - carousel.position.value) < .01) {
      const key = hand.current?.key;
      pressingKey.value = key || null;
      holdTimer = setTimeout(() => {
        if (gesture && !gesture.moved && key && hand.current?.key === key) readyKey.value = key;
      }, 800);
    }
  }
  function pointerMove(event: PointerEvent): void {
    const state = gesture;
    if (!state || state.pointer !== event.pointerId) return;
    const dx = event.clientX - state.x, dy = event.clientY - state.y;
    if (!state.moved && Math.hypot(dx, dy) < 8) return;
    if (!options.expanded.value) return;
    state.moved = true;
    pressingKey.value = null;
    clearTimeout(holdTimer);
    event.preventDefault();
    if (readyKey.value) {
      if (!lifted.value) {
        const card = hand.current;
        const rect = state.element?.getBoundingClientRect();
        if (!card || !rect) return;
        lifted.value = { card, left: rect.left, top: rect.top, width: rect.width, height: rect.height,
          originLeft: rect.left, originTop: rect.top, phase: 'dragging' };
      }
      lifted.value.left = lifted.value.originLeft + dx;
      lifted.value.top = lifted.value.originTop + dy;
      return;
    }
    if (hand.cards.length < 2) return;
    dragging.value = true;
    const raw = state.position - dx / state.spacing;
    const next = hand.cards.length === 2 ? Math.max(0, Math.min(1, raw)) : raw;
    const elapsed = event.timeStamp - state.lastTime;
    if (elapsed > 0) state.velocity = (next - state.lastPosition) / elapsed;
    state.lastTime = event.timeStamp;
    state.lastPosition = next;
    carousel.seek(next);
  }
  function pointerUp(event: PointerEvent): void {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const state = release()!;
    const lift = lifted.value;
    if (lift) {
      const rect = options.root.value?.getBoundingClientRect();
      const outside = rect && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
      if (outside) {
        readyKey.value = null;
        lift.phase = 'throwing';
        const key = lift.card.key;
        const finish = () => { lifted.value = null; hand.remove(key); carousel.seek(hand.activeIndex); };
        if (hand.cards.length > 1) carousel.settle(nextHandPosition(carousel.position.value, 1, hand.cards.length), () => {
          hand.select(wrapHandIndex(Math.round(carousel.position.value), hand.cards.length));
          finish();
        });
        else liftTimer = setTimeout(finish, 320);
      } else {
        lift.phase = 'returning'; lift.left = lift.originLeft; lift.top = lift.originTop;
        liftTimer = setTimeout(() => { lifted.value = null; readyKey.value = null; }, 320);
      }
      return;
    }
    if (readyKey.value) { readyKey.value = null; return; }
    if (state.moved) {
      const velocity = event.timeStamp - state.lastTime > 100 ? 0 : state.velocity;
      settle(snapHandPosition(carousel.position.value, velocity));
    } else if (state.virtual === null) {
      // 空白区也能起手拖动；仅点击时恢复按下前的转动目标，不能停在半张牌的位置。
      if (options.expanded.value) settle(carousel.target());
    } else activate(state.virtual);
  }
  function lostCapture(): void { if (gesture) cancel(); }
  function wheel(event: WheelEvent): void {
    if (!options.active() || !hand.cards.length || options.disabled() || lifted.value || gesture) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    // 首次滚动只展开当前牌；展开期间由布局动效的 changing 状态禁用交互，不叠加切牌。
    if (!options.expanded.value) {
      wheelSum = 0; lastWheel = 0; lastStep = -Infinity;
      expandAt(hand.activeIndex);
      return;
    }
    if (hand.cards.length < 2) return;
    const now = performance.now();
    if (now - lastWheel > 180) wheelSum = 0;
    lastWheel = now;
    if (now - lastStep < 280) return;
    wheelSum += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 240 : 1);
    if (Math.abs(wheelSum) < 45) return;
    step(wheelSum > 0 ? 1 : -1);
    wheelSum = 0; lastStep = now;
  }
  const liftStyle = computed(() => {
    const card = lifted.value;
    return card ? { left: `${card.left}px`, top: `${card.top}px`, width: `${card.width}px`, height: `${card.height}px` } : {};
  });
  watch(options.expanded, expanded => { if (!expanded) cancel(); });
  watch(options.active, active => { if (!active) cancel(); });
  watch(() => hand.cards.map(card => card.key).join('|'), () => cancel());
  watch(() => hand.activeIndex, index => {
    if (!carousel.moving.value && wrapHandIndex(Math.round(carousel.position.value), hand.cards.length) !== index) carousel.seek(index);
  });
  onBeforeUnmount(cancel);
  return { position: carousel.position, moving: carousel.moving, dragging, pressingKey, readyKey, lifted, liftStyle,
    activate, expandAt, step, pointerDown, pointerMove, pointerUp, lostCapture, wheel, cancel, freezeSelection };
}
