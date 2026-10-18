import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { settingsApi } from '../api/commands/settings';
import { libraryApi } from '../api/commands/library';
import { useEhSettingsStore } from './ehSettings';
import { useLibraryConsoleStore } from './libraryConsole';
import type { EhLibraryDashboard } from '../api/contracts/settings';

const dashboard = (count: number): EhLibraryDashboard => ({ total_count: count, total_bytes: count * 100, total_pages: count, categories: [] });
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.restoreAllMocks());

describe('statistics requests', () => {
  it('coalesces overlapping book requests and retains cached data after failure', async () => {
    const store = useEhSettingsStore(); store.ehLibraryPath = 'books';
    let release!: (value: EhLibraryDashboard) => void;
    const request = vi.spyOn(settingsApi, 'getEhDashboard').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const first = store.loadDashboard(), second = store.loadDashboard();
    expect(request).toHaveBeenCalledOnce(); expect(store.dashboardLoading).toBe(true); expect(store.dashboardLoaded).toBe(false);
    release(dashboard(20)); await Promise.all([first, second]);
    expect(store.dashboardLoaded).toBe(true); expect(store.dashboardLoading).toBe(false);
    request.mockRejectedValueOnce(new Error('offline'));
    expect(await store.loadDashboard()).toBe(false);
    expect(store.ehDashboard.total_count).toBe(20); expect(store.dashboardLoaded).toBe(true);
    expect(store.dashboardError).toContain('offline');
    request.mockResolvedValueOnce(dashboard(21)); await store.loadDashboard();
    expect(store.dashboardError).toBe(''); expect(store.ehDashboard.total_count).toBe(21);
  });

  it('does not let an old library response overwrite the newly bound library', async () => {
    const store = useEhSettingsStore(); store.ehLibraryPath = 'old';
    const releases: Array<(value: EhLibraryDashboard) => void> = [];
    vi.spyOn(settingsApi, 'getEhDashboard').mockImplementation(() => new Promise(resolve => releases.push(resolve)));
    const old = store.loadDashboard(); store.ehLibraryPath = 'new';
    const current = store.loadDashboard();
    releases[0](dashboard(100)); await old;
    expect(store.dashboardLoading).toBe(true); expect(store.dashboardLoaded).toBe(false);
    releases[1](dashboard(2)); await current;
    expect(store.ehDashboard.total_count).toBe(2); expect(store.dashboardLoading).toBe(false);
  });

  it('fetches a fresh aggregate after mutation rather than sharing the prior snapshot', async () => {
    const store = useEhSettingsStore(); store.ehLibraryPath = 'books';
    const releases: Array<(value: EhLibraryDashboard) => void> = [];
    const request = vi.spyOn(settingsApi, 'getEhDashboard').mockImplementation(() => new Promise(resolve => releases.push(resolve)));
    const first = store.loadDashboard(), fresh = store.loadDashboard(true);
    releases[0](dashboard(1)); await first;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    releases[1](dashboard(2)); await fresh;
    expect(store.ehDashboard.total_count).toBe(2);
  });

  it('coalesces media requests while preserving its own loading and error state', async () => {
    const store = useLibraryConsoleStore(); store.mediaPath = 'media';
    let release!: (value: typeof store.summary) => void;
    const request = vi.spyOn(libraryApi, 'getSummary').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const first = store.loadSummary(), second = store.loadSummary();
    expect(request).toHaveBeenCalledOnce(); expect(store.summaryLoading).toBe(true);
    release({ archived_count: 10, unarchived_count: 2, episode_count: 30, total_bytes: 100 });
    await Promise.all([first, second]); expect(store.summaryLoaded).toBe(true);
    request.mockRejectedValueOnce(new Error('offline')); await store.loadSummary();
    expect(store.totalWorks).toBe(12); expect(store.summaryError).toContain('offline');
  });
});
