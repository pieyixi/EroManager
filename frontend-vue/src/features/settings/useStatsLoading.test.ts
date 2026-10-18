import { afterEach, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useStatsLoading } from './useStatsLoading';
afterEach(() => vi.useRealTimers());

it('delays refresh fading, reports requests beyond three seconds and cleans up on close', async () => {
  vi.useFakeTimers();
  const open = ref(true), pending = ref(true), scope = effectScope();
  const state = scope.run(() => useStatsLoading(() => open.value, () => pending.value))!;
  await vi.advanceTimersByTimeAsync(149); expect(state.delayed.value).toBe(false);
  await vi.advanceTimersByTimeAsync(1); expect(state.delayed.value).toBe(true);
  await vi.advanceTimersByTimeAsync(2849); expect(state.slow.value).toBe(false);
  await vi.advanceTimersByTimeAsync(1); expect(state.slow.value).toBe(true);
  open.value = false; await nextTick();
  expect(state.slow.value).toBe(false); expect(state.delayed.value).toBe(false); expect(vi.getTimerCount()).toBe(0);
  scope.stop();
});

it('does not show feedback for a fast response and clears timers on disposal', async () => {
  vi.useFakeTimers();
  const pending = ref(true), scope = effectScope();
  const state = scope.run(() => useStatsLoading(() => true, () => pending.value))!;
  await vi.advanceTimersByTimeAsync(80); pending.value = false; await nextTick();
  expect(state.delayed.value).toBe(false); expect(vi.getTimerCount()).toBe(0);
  pending.value = true; await nextTick(); scope.stop();
  expect(vi.getTimerCount()).toBe(0);
});
