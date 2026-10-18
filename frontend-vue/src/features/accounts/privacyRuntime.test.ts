import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
const native = vi.hoisted(() => ({ minimized: false, callbacks: new Map<string, () => void>(), stops: [] as (() => void)[] }));
const lock = vi.hoisted(() => vi.fn());
vi.mock('./controller', () => ({ lockAccount: lock }));
vi.mock('../../api/tauri', () => ({
  currentTauriWindow: () => ({ isMinimized: async () => native.minimized }),
  listenTauri: async (event: string, callback: () => void) => { native.callbacks.set(event, callback); const stop = vi.fn(); native.stops.push(stop); return stop; },
}));
import { useAccountsStore } from '../../stores/accounts';
import { usePlayerStore } from '../../stores/player';
import { installAccountPrivacy } from './privacyRuntime';

describe('privacy lock boundaries', () => {
  let dispose: () => void;
  beforeEach(() => {
    vi.useFakeTimers(); setActivePinia(createPinia()); lock.mockReset(); native.callbacks.clear(); native.stops = []; native.minimized = false;
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    vi.stubGlobal('window', new EventTarget());
    const accounts = useAccountsStore(); accounts.initialized = true;
    lock.mockImplementation(async () => { accounts.locked = true; });
    dispose = installAccountPrivacy();
  });
  afterEach(() => { dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('cancels a delayed background lock on returning, then locks on a later full delay', async () => {
    const accounts = useAccountsStore(); accounts.privacy.background_seconds = 15;
    window.dispatchEvent(new Event('blur')); await vi.advanceTimersByTimeAsync(14000);
    window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(2000); expect(lock).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('blur')); await vi.advanceTimersByTimeAsync(15000); expect(lock).toHaveBeenCalledTimes(1);
  });
  it('supports immediate background lock separately from the disabled setting', async () => {
    window.dispatchEvent(new Event('blur')); await vi.advanceTimersByTimeAsync(1000); expect(lock).not.toHaveBeenCalled();
    useAccountsStore().privacy.background_seconds = 1; window.dispatchEvent(new Event('blur')); expect(lock).toHaveBeenCalledTimes(1);
  });
  it('locks minimized windows only when enabled, including the native tray boundary', async () => {
    native.minimized = true; window.dispatchEvent(new Event('resize')); await nextTick(); expect(lock).not.toHaveBeenCalled();
    useAccountsStore().privacy.minimize = true; window.dispatchEvent(new Event('resize')); await nextTick(); expect(lock).toHaveBeenCalledTimes(1);
    useAccountsStore().locked = false; native.callbacks.get('privacy-minimized')!(); expect(lock).toHaveBeenCalledTimes(2);
  });
  it('respects the system lock setting and ignores repeated boundaries while already locked', () => {
    const accounts = useAccountsStore(); accounts.privacy.system = false; native.callbacks.get('privacy-system-boundary')!(); expect(lock).not.toHaveBeenCalled();
    accounts.privacy.system = true; native.callbacks.get('privacy-system-boundary')!(); native.callbacks.get('privacy-system-boundary')!(); expect(lock).toHaveBeenCalledTimes(1);
  });
  it('exempts playing video only from idle lock and applies the override', async () => {
    const accounts = useAccountsStore(), player = usePlayerStore(); accounts.privacy.idle_seconds = 1;
    player.nativeVisible = true; player.paused = false; await nextTick(); await vi.advanceTimersByTimeAsync(2000); expect(lock).not.toHaveBeenCalled();
    accounts.privacy.while_playing = true; await nextTick(); await vi.advanceTimersByTimeAsync(2000); expect(lock).toHaveBeenCalledTimes(1);
  });
  it('cleans up activity listeners, pending timers and native subscriptions', async () => {
    useAccountsStore().privacy.background_seconds = 15; window.dispatchEvent(new Event('blur')); await nextTick(); dispose();
    window.dispatchEvent(new Event('blur')); await vi.advanceTimersByTimeAsync(20000); expect(lock).not.toHaveBeenCalled();
    expect(native.stops).toHaveLength(2); for (const stop of native.stops) expect(stop).toHaveBeenCalled();
  });
});
