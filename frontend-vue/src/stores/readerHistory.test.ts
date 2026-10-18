import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ehApi } from '../api/commands/eh';
import { preferencesApi } from '../api/commands/preferences';
import { useEhReaderStore } from './ehReader';
import { usePreferencesStore } from './preferences';
import type { EhGallerySummary } from '../api/contracts/eh';

vi.mock('../api/commands/preferences', () => ({ preferencesApi: { getRecord: vi.fn(), setRecord: vi.fn().mockResolvedValue(undefined), set: vi.fn().mockImplementation(value => Promise.resolve(value)) } }));
vi.mock('../api/commands/eh', () => ({ ehApi: { getPages: vi.fn() } }));
const gallery = { gid: -42, title: '隔离阅读记录' } as EhGallerySummary;
const record = { kind: 'book' as const, content_id: -42, position: 7, pair_offset: 0, merged_pairs: ['6:7'] };
function setup() {
  const reader = useEhReaderStore();
  reader.loadPaths = vi.fn().mockResolvedValue(undefined);
  reader.prefetchNearby = vi.fn().mockResolvedValue(undefined);
  usePreferencesStore().loaded = true;
  return reader;
}
describe('reader preferences and work history boundaries', () => {
  beforeEach(() => {
    setActivePinia(createPinia()); vi.clearAllMocks();
    vi.mocked(ehApi.getPages).mockResolvedValue(Array.from({ length: 12 }, (_, index) => ({ index, path: `page-${index}`, width: 900, height: 1400 })));
    vi.mocked(preferencesApi.getRecord).mockResolvedValue(record);
  });
  it('restores raw page in a different page mode and resets temporary zoom on reopening', async () => {
    const reader = setup(), preferences = usePreferencesStore();
    preferences.values.reader_mode = 'single'; preferences.values.reader_zoom = 125;
    await reader.open(gallery);
    expect(reader.currentSpread?.pages[0].index).toBe(7);
    expect(reader.currentPairMerged).toBe(false);
    expect(reader.mergedPairs['6:7']).toBe(true);
    reader.zoom = 160;
    await reader.open(gallery);
    expect(reader.zoom).toBe(125);
    expect(preferences.values.reader_zoom).toBe(125);
  });
  it('only records a presented page, and keeps the old position while memory is disabled', async () => {
    const reader = setup(), preferences = usePreferencesStore();
    await reader.open(gallery);
    reader.goToPage(10); reader.saveWorkRecord();
    expect(preferencesApi.setRecord).toHaveBeenLastCalledWith(expect.objectContaining({ content_id: -42, position: 7 }));
    reader.markPresented(10);
    expect(preferencesApi.setRecord).toHaveBeenLastCalledWith(expect.objectContaining({ position: 10 }));
    preferences.values.remember_reading = false;
    reader.markPresented(2);
    expect(preferencesApi.setRecord).toHaveBeenLastCalledWith(expect.objectContaining({ position: 10 }));
  });
  it('does not overwrite unreadable history with an empty record', async () => {
    const reader = setup();
    vi.mocked(preferencesApi.getRecord).mockRejectedValue(new Error('locked'));
    await reader.open(gallery); reader.markPresented(4); reader.close();
    expect(reader.recordError).toContain('读取失败');
    expect(preferencesApi.setRecord).not.toHaveBeenCalled();
  });
  it('saves pairing changes per work without turning them into global preferences', async () => {
    const reader = setup();
    await reader.open(gallery);
    reader.toggleCurrentPairMerge();
    expect(preferencesApi.setRecord).toHaveBeenLastCalledWith(expect.objectContaining({ content_id: -42, merged_pairs: [] }));
    reader.togglePairing();
    expect(preferencesApi.setRecord).toHaveBeenLastCalledWith(expect.objectContaining({ pair_offset: 1 }));
    expect(preferencesApi.set).not.toHaveBeenCalled();
  });
});
