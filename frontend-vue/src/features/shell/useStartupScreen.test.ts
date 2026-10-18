import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick } from 'vue';
import { useStartupScreen } from './useStartupScreen';
import { useHomeStore } from '../../stores/home';
import { useLibraryStore } from '../../stores/library';
import { useEhLibraryStore } from '../../stores/ehLibrary';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function fixture() {
  vi.stubGlobal('Image', class { src = ''; decoding = ''; naturalWidth = 600; naturalHeight = 800; decode() { return Promise.resolve(); } });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { queueMicrotask(callback); return 1; });
  setActivePinia(createPinia());
  const home = useHomeStore(), media = useLibraryStore(), books = useEhLibraryStore();
  vi.spyOn(home, 'ensureSelections').mockImplementation(() => undefined);
  vi.spyOn(media, 'loadVisibleCovers').mockResolvedValue();
  vi.spyOn(books, 'loadVisibleCovers').mockResolvedValue();
  vi.spyOn(media, 'prefetchCovers').mockResolvedValue();
  const scope = effectScope();
  const screen = scope.run(() => useStartupScreen())!;
  return { home, media, books, scope, screen };
}

describe('startup content readiness', () => {
  it('prepares both first draws, covers and card backs while keeping opening paused for entry', async () => {
    const f = fixture();
    vi.spyOn(f.media, 'pagedWorks', 'get').mockReturnValue([{ cover_path: 'cover' }] as never);
    f.media.coverCache.cover = 'cover-url';
    const decodes: Array<() => void> = [];
    vi.stubGlobal('Image', class {
      src = ''; decoding = ''; naturalWidth = 600; naturalHeight = 800;
      decode() { return new Promise<void>(resolve => { decodes.push(resolve); }); }
    });
    f.home.media.phase = 'waiting'; f.home.media.loading = true;
    f.home.book.phase = 'opening';
    let ready = false;
    const pending = f.screen.prepare().then(() => { ready = true; });
    await vi.waitFor(() => expect(decodes).toHaveLength(3));
    decodes.forEach(resolve => resolve()); await nextTick();
    expect(ready).toBe(false);
    f.home.media.phase = 'opening'; f.home.media.loading = false; await pending;
    expect(ready).toBe(true);
    expect(f.screen.drawsHeld.value).toBe(true);
    expect(f.home.media.phase).toBe('opening');
    f.screen.finish(); expect(f.screen.visible.value).toBe(false);
    expect(f.screen.drawsHeld.value).toBe(true);
    f.screen.reveal(); expect(f.screen.drawsHeld.value).toBe(false);
    expect(f.media.prefetchCovers).not.toHaveBeenCalled();
    f.home.media.phase = 'idle'; f.home.book.phase = 'idle'; await nextTick();
    expect(f.media.prefetchCovers).toHaveBeenCalledOnce();
    f.scope.stop();
  });

  it('allows empty libraries and failed cover requests to reach the existing page state', async () => {
    const f = fixture();
    vi.spyOn(f.media, 'loadVisibleCovers').mockRejectedValue(new Error('offline'));
    await expect(f.screen.prepare()).resolves.toBeUndefined();
    f.scope.stop();
  });

  it('releases a stuck startup and cleans waiting animation observers on timeout or disposal', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.home.book.phase = 'waiting'; f.home.book.loading = true;
    const pending = f.screen.prepare(); await nextTick();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).resolves.toBeUndefined();
    expect(f.screen.visible.value).toBe(false);
    f.scope.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
