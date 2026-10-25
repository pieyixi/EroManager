import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, ref, type EffectScope } from 'vue';

const lifecycle = vi.hoisted(() => ({ unmounted: [] as Array<() => void> }));
vi.mock('vue', async original => ({ ...await original<typeof import('vue')>(),
  onBeforeUnmount: (callback: () => void) => lifecycle.unmounted.push(callback),
}));
import { useHomeHandStore } from '../../stores/homeHand';
import { useHandInteraction } from './useHandInteraction';

describe('hand interaction', () => {
  let scope: EffectScope;
  let frames: Map<number, FrameRequestCallback>;
  beforeEach(() => {
    setActivePinia(createPinia()); scope = effectScope(); frames = new Map();
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });
  afterEach(() => {
    lifecycle.unmounted.splice(0).forEach(callback => callback());
    scope.stop(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it.each([[1, 0, 120], [2, 0, -120], [3, 1, 120], [5, 3, -120]])(
    'first wheel expands without changing the selected card (%i cards, index %i, delta %i)', (count, initial, deltaY) => {
      const hand = useHomeHandStore();
      for (let id = 1; id <= count; id++) hand.add('media', { id, title: `Work ${id}`, cover: '', previews: [] });
      hand.select(initial);
      const expanded = ref(false), disabled = ref(false);
      const interaction = scope.run(() => useHandInteraction({
        root: ref(null), expanded, active: () => true, disabled: () => disabled.value, open: vi.fn(),
      }))!;
      const wheel = { deltaX: 0, deltaY, deltaMode: 0 } as WheelEvent;
      interaction.wheel(wheel);
      expect(expanded.value).toBe(true);
      expect(hand.activeIndex).toBe(initial);
      expect(interaction.position.value).toBe(initial);
      expect(interaction.moving.value).toBe(false);
      expect(frames.size).toBe(0);

      // 实际组件在布局展开到交接完成期间保持 disabled；期间滚动不能积攒成切牌。
      disabled.value = true;
      for (let index = 0; index < 10; index++) interaction.wheel(wheel);
      expect(hand.activeIndex).toBe(initial);
      expect(frames.size).toBe(0);
      disabled.value = false;
      interaction.wheel(wheel);
      if (count === 1) {
        expect(frames.size).toBe(0);
      } else {
        expect(interaction.moving.value).toBe(true);
        const [frame, tick] = frames.entries().next().value!;
        frames.delete(frame); tick(640);
        const expected = (initial + Math.sign(deltaY) + count) % count;
        expect(hand.activeIndex).toBe(expected);
        expect(interaction.moving.value).toBe(false);
      }
    });

  it('discards partial wheel input when the interaction is cancelled', () => {
    const hand = useHomeHandStore();
    for (let id = 1; id <= 3; id++) hand.add('media', { id, title: `Work ${id}`, cover: '', previews: [] });
    const interaction = scope.run(() => useHandInteraction({
      root: ref(null), expanded: ref(true), active: () => true, disabled: () => false, open: vi.fn(),
    }))!;
    const wheel = { deltaX: 0, deltaY: 30, deltaMode: 0 } as WheelEvent;
    interaction.wheel(wheel);
    interaction.cancel();
    interaction.wheel(wheel);
    expect(interaction.moving.value).toBe(false);
    expect(frames.size).toBe(0);
  });

  it.each([[2, 0, 1], [3, 0, 1], [3, 2, 3]])('commits the visible card before opening (%i cards, %i to virtual %i)', (count, initial, target) => {
    const hand = useHomeHandStore();
    for (let id = 1; id <= count; id++) hand.add('media', { id, title: `Work ${id}`, cover: '', previews: [] });
    hand.select(initial);
    const opened: Array<{ card: string; selected: string | undefined }> = [];
    const interaction = scope.run(() => useHandInteraction({
      root: ref(null), expanded: ref(true), active: () => true, disabled: () => false,
      open: card => opened.push({ card: card.key, selected: hand.current?.key }),
    }))!;
    interaction.step(1);
    const [frame, tick] = frames.entries().next().value!;
    frames.delete(frame); tick(480);
    expect(interaction.moving.value).toBe(true);
    expect(Math.abs(interaction.position.value - target)).toBeLessThan(.01);
    expect(hand.activeIndex).toBe(initial);
    const event = { button: 0, isPrimary: true, pointerId: 1, clientX: 100, clientY: 100, timeStamp: 480,
      currentTarget: { offsetWidth: 172 }, preventDefault: vi.fn() } as unknown as PointerEvent;
    interaction.pointerDown(event, target); // stop() removes the original completion callback.
    interaction.pointerUp(event);
    const expected = hand.cards[target % count]!.key;
    expect(opened).toEqual([{ card: expected, selected: expected }]);
    expect(interaction.position.value).toBe(target);
    expect(frames.size).toBe(0);
    interaction.activate(target);
    expect(opened[1]).toEqual({ card: expected, selected: expected });
  });
});
