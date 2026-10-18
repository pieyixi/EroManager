import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { TauriWindowHandle } from '../../api/tauri';

const lifecycle = vi.hoisted(() => ({ mounted: [] as Array<() => unknown>, unmounted: [] as Array<() => unknown> }));
vi.mock('vue', async importOriginal => ({
  ...await importOriginal<typeof import('vue')>(),
  onMounted: (callback: () => unknown) => lifecycle.mounted.push(callback),
  onBeforeUnmount: (callback: () => unknown) => lifecycle.unmounted.push(callback),
}));
vi.mock('../../api/tauri', () => ({ currentTauriWindow: vi.fn() }));
vi.mock('./closeController', () => ({ requestClose: vi.fn().mockResolvedValue(undefined) }));
import { requestClose } from './closeController';
import { currentTauriWindow } from '../../api/tauri';
import { useShellWindowControls } from './useShellWindowControls';

describe('ordinary shell window controller', () => {
  beforeEach(() => { setActivePinia(createPinia()); lifecycle.mounted.length = 0; lifecycle.unmounted.length = 0; vi.resetAllMocks(); });

  it('keeps native controls safe in browser and delegates close to the shared policy', async () => {
    vi.mocked(currentTauriWindow).mockReturnValue(null);
    const controls = useShellWindowControls();
    await lifecycle.mounted[0]();
    await controls.minimizeWindow(); await controls.toggleMaximize(); await controls.closeWindow();
    lifecycle.unmounted[0]();
    expect(controls.maximized.value).toBe(false);
    expect(requestClose).toHaveBeenCalledOnce();
  });

  it('forwards controls, synchronizes maximization and releases its resize subscription', async () => {
    let maximized = true;
    let resize: () => void = () => {};
    const unsubscribe = vi.fn();
    const handle = {
      isMaximized: vi.fn(async () => maximized),
      minimize: vi.fn(async () => {}), close: vi.fn(async () => {}),
      toggleMaximize: vi.fn(async () => { maximized = !maximized; }),
      onResized: vi.fn(async (callback: () => void) => { resize = callback; return unsubscribe; }),
    };
    vi.mocked(currentTauriWindow).mockReturnValue(handle as unknown as TauriWindowHandle);
    const controls = useShellWindowControls();
    await lifecycle.mounted[0]();
    expect(controls.maximized.value).toBe(true);
    await controls.toggleMaximize();
    expect(controls.maximized.value).toBe(false);
    maximized = true; resize(); await Promise.resolve(); await Promise.resolve();
    expect(controls.maximized.value).toBe(true);
    await controls.minimizeWindow(); await controls.closeWindow();
    expect(handle.minimize).toHaveBeenCalledOnce(); expect(handle.close).not.toHaveBeenCalled();
    expect(requestClose).toHaveBeenCalledOnce();
    lifecycle.unmounted[0]();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('retains the ordinary-window fallback when native queries or subscriptions fail', async () => {
    vi.mocked(currentTauriWindow).mockReturnValue({
      isMaximized: vi.fn().mockRejectedValue(new Error('unavailable')),
      onResized: vi.fn().mockRejectedValue(new Error('unavailable')),
    } as unknown as TauriWindowHandle);
    const controls = useShellWindowControls();
    await lifecycle.mounted[0]();
    expect(controls.maximized.value).toBe(false);
    expect(() => lifecycle.unmounted[0]()).not.toThrow();
  });
});
