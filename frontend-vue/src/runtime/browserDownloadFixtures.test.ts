import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createDownloadScene } from '../api/mock/downloadScene';
import { isDownloadComplete, useEhDownloadStore } from '../stores/ehDownload';
import { installBrowserDownloadFixtures } from './browserDownloadFixtures';

describe('browser download showcase', () => {
  beforeEach(() => setActivePinia(createPinia()));
  it('contains every state for both sources with matching complete gallery identities', () => {
    const scene = createDownloadScene();
    for (const source of ['eh', 'hitomi'] as const) {
      expect(scene.queue.filter(job => job.source === source).map(job => job.status)).toEqual(['queued', 'downloading']);
      const history = scene.history.filter(item => item.source === source);
      expect(history.some(item => item.failedPages.length)).toBe(true);
      expect(history.some(item => item.error)).toBe(true);
      expect(history.filter(isDownloadComplete)).toHaveLength(4);
      for (const item of history.filter(isDownloadComplete)) expect(scene.galleries.some(gallery => gallery.gid === item.gid)).toBe(true);
    }
  });
  it('seeds snapshots without running a worker, persisting history or duplicating existing records', () => {
    const store = useEhDownloadStore();
    const persist = vi.spyOn(store, 'persistHistory');
    const stop = installBrowserDownloadFixtures();
    const stopAgain = installBrowserDownloadFixtures();
    expect(store.cards).toHaveLength(16);
    expect(store.workerRunning).toBe(false); expect(persist).not.toHaveBeenCalled();
    stopAgain(); stop();
  });
  it('removes showcase jobs before a manual enqueue so the real FIFO remains usable', () => {
    const store = useEhDownloadStore();
    const stop = installBrowserDownloadFixtures();
    vi.spyOn(store, 'processQueue').mockResolvedValue();
    store.enqueue('hitomi', 123456);
    expect(store.queue.map(job => job.key)).toEqual(['hitomi:123456']);
    expect(store.history).toHaveLength(12);
    stop();
  });
});
