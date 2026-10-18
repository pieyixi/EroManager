import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { preferencesApi } from '../api/commands/preferences';
import { defaultPreferences } from '../api/contracts/preferences';
import { usePreferencesStore } from './preferences';
vi.mock('../api/commands/preferences', () => ({ preferencesApi: { get: vi.fn(), set: vi.fn(), info: vi.fn() } }));
beforeEach(() => { setActivePinia(createPinia()); vi.resetAllMocks(); vi.mocked(preferencesApi.info).mockResolvedValue({ version:'5.1.0',app_directory:'test',database_directory:'test/db' }); });
describe('persistent preferences', () => {
  it('serializes rapid edits without replacing a newer value with an old response', async () => {
    const store = usePreferencesStore(); store.loaded = true;
    let resolve!: (p: ReturnType<typeof defaultPreferences>) => void;
    vi.mocked(preferencesApi.set).mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockImplementation(async p => p);
    store.update({ player_volume: 20 });
    store.update({ player_volume: 65 });
    store.update({ reader_direction: 'ltr' });
    expect(preferencesApi.set).toHaveBeenCalledTimes(1);
    resolve({ ...defaultPreferences(), player_volume: 20 });
    await vi.waitFor(() => expect(store.saving).toBe(false));
    expect(preferencesApi.set).toHaveBeenLastCalledWith(expect.objectContaining({player_volume:65,reader_direction:'ltr'}));
    expect(store.values.player_volume).toBe(65);
    expect(store.savedRevision).toBe(store.revision);
  });
  it('does not overwrite stored data after a read failure, and can retry', async () => {
    vi.mocked(preferencesApi.get).mockRejectedValueOnce(new Error('locked')).mockResolvedValue({...defaultPreferences(),player_volume:42});
    const store=usePreferencesStore(); await store.load();
    store.update({player_volume:99});
    expect(preferencesApi.set).not.toHaveBeenCalled();
    expect(store.error).toContain('locked');
    await store.load(); expect(store.values.player_volume).toBe(42); expect(store.error).toBe('');
  });
  it('keeps failed writes visible and retries the latest preferences', async () => {
    const store=usePreferencesStore();store.loaded=true;
    vi.mocked(preferencesApi.set).mockRejectedValueOnce(new Error('disk full')).mockImplementation(async p=>p);
    store.update({reader_zoom:125});
    await vi.waitFor(()=>expect(store.error).toContain('disk full'));
    await store.save();expect(store.error).toBe('');expect(store.values.reader_zoom).toBe(125);
  });
});
