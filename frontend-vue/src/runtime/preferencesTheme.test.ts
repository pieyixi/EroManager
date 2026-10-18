import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { defaultPreferences, type UserPreferences } from '../api/contracts/preferences';
import { usePreferencesStore } from '../stores/preferences';
import { useUiStore } from '../stores/ui';
import { installPreferencesRuntime } from './preferencesRuntime';

vi.mock('../api/commands/preferences', () => ({ preferencesApi: { set: vi.fn(async (value: UserPreferences) => value) } }));
interface Snapshot { update: () => void; ready: () => void; finished: () => void; applied: boolean }
let snapshots: Snapshot[], stop: (() => void) | undefined;
let root: { dataset: Record<string, string>; style: { colorScheme: string }; offsetWidth: number; animate: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.useFakeTimers(); setActivePinia(createPinia()); snapshots = [];
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  root = { dataset: {}, style: { colorScheme: '' }, offsetWidth: 1366, animate: vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() })) };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage, innerWidth: 1366, innerHeight: 768 });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
  vi.stubGlobal('document', { documentElement: root, startViewTransition: vi.fn((commit: () => void) => {
    let ready!: () => void, finished!: () => void;
    const transition = { ready: new Promise<void>(resolve => { ready = resolve; }), finished: new Promise<void>(resolve => { finished = resolve; }) };
    const snapshot: Snapshot = { applied: false, ready, finished, update: () => { if (!snapshot.applied) { snapshot.applied = true; commit(); } } };
    snapshots.push(snapshot); return transition;
  }) });
});
async function hydrate() {
  const preferences = usePreferencesStore(), ui = useUiStore();
  stop = installPreferencesRuntime(); preferences.values = { ...defaultPreferences(), theme: 'light' }; preferences.loaded = true;
  await nextTick(); return { preferences, ui };
}
async function finish(snapshot: Snapshot): Promise<void> {
  snapshot.update(); snapshot.ready(); snapshot.finished(); await nextTick(); await vi.runAllTimersAsync();
}
afterEach(async () => {
  for (const snapshot of snapshots) await finish(snapshot);
  stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

it('keeps the old theme intact until the sidebar snapshot callback, then persists without a soft transition', async () => {
  const { preferences, ui } = await hydrate();
  ui.toggleTheme({ x: 32, y: 620 }); await nextTick();
  expect(snapshots).toHaveLength(1);
  expect(ui.theme).toBe('light'); expect(preferences.values.theme).toBe('light');
  expect(root.dataset.theme).toBe('light'); expect(root.dataset.themeSoft).toBeUndefined();
  expect(ui.manualThemeRevision).toBe(0);
  await finish(snapshots[0]!);
  expect(ui.theme).toBe('dark'); expect(preferences.values.theme).toBe('dark');
  expect(root.dataset.theme).toBe('dark'); expect(root.dataset.themeSoft).toBeUndefined();
  expect(ui.manualThemeRevision).toBe(1); expect(root.animate).toHaveBeenCalledOnce();
});

it('does not persist an ignored second sidebar click while a reveal is running', async () => {
  const { preferences, ui } = await hydrate();
  ui.toggleTheme(); ui.toggleTheme(); await nextTick(); expect(snapshots).toHaveLength(1);
  snapshots[0]!.update(); await nextTick();
  ui.toggleTheme(); await nextTick();
  expect(snapshots).toHaveLength(1); expect(ui.manualThemeRevision).toBe(1);
  expect(ui.theme).toBe('dark'); expect(preferences.values.theme).toBe('dark'); expect(root.dataset.themeSoft).toBeUndefined();
  await finish(snapshots[0]!);
});

it('retains the settings soft-color path without starting a circular snapshot', async () => {
  const { preferences, ui } = await hydrate();
  preferences.update({ theme: 'dark' }); ui.setTheme('dark', undefined, 'soft'); await nextTick();
  expect(ui.theme).toBe('dark'); expect(root.dataset.themeSoft).toBe('true');
  expect(snapshots).toHaveLength(0); expect(ui.manualThemeRevision).toBe(0);
  await vi.advanceTimersByTimeAsync(260); expect(root.dataset.themeSoft).toBeUndefined();
});

it('clears an unfinished settings fade before a sidebar reveal takes its old snapshot', async () => {
  const { preferences, ui } = await hydrate();
  preferences.update({ theme: 'dark' }); ui.setTheme('dark', undefined, 'soft'); await nextTick();
  ui.toggleTheme(); await nextTick();
  expect(ui.theme).toBe('dark'); expect(preferences.values.theme).toBe('dark');
  expect(root.dataset.themeSoft).toBeUndefined(); expect(snapshots).toHaveLength(1);
  await finish(snapshots[0]!);
  expect(ui.theme).toBe('light'); expect(preferences.values.theme).toBe('light');
  expect(root.dataset.themeSoft).toBeUndefined();
});
