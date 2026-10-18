import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { usePreferencesStore } from '../../stores/preferences';
import { preferencesApi, flushWorkRecords } from '../../api/commands/preferences';
import { systemApi } from '../../api/commands/system';
import { cancelClose, closeState, confirmClose, requestClose, requestExit } from './closeController';
vi.mock('../../api/commands/system', () => ({ systemApi: { closeApplication: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../api/commands/preferences', () => ({ preferencesApi: { set: vi.fn().mockImplementation(async value => value) }, flushWorkRecords: vi.fn().mockResolvedValue(undefined) }));
beforeEach(() => {
  setActivePinia(createPinia()); vi.clearAllMocks();
  Object.assign(closeState, { visible: false, selected: 'tray', noAsk: false, busy: false, error: '' });
  usePreferencesStore().loaded = true;
});
describe('close policy', () => {
  it('prompts once; cancelling changes neither preference nor native window', async () => {
    await requestClose(); await requestClose();
    expect(closeState.visible).toBe(true);
    closeState.selected = 'exit'; closeState.noAsk = true;
    cancelClose();
    expect(systemApi.closeApplication).not.toHaveBeenCalled();
    expect(usePreferencesStore().values.close_action).toBe('tray');
    expect(usePreferencesStore().values.close_prompt).toBe(true);
  });
  it('saves the chosen action and no-ask checkbox before executing, then skips the next prompt', async () => {
    await requestClose(); closeState.selected = 'exit'; closeState.noAsk = true;
    await confirmClose();
    expect(preferencesApi.set).toHaveBeenLastCalledWith(expect.objectContaining({ close_action: 'exit', close_prompt: false }));
    expect(systemApi.closeApplication).toHaveBeenLastCalledWith('exit');
    expect(closeState.visible).toBe(false);
    await requestClose();
    expect(systemApi.closeApplication).toHaveBeenCalledTimes(2);
  });
  it('waits for preference writes and blocks a duplicate confirmation', async () => {
    let finish!: (value: ReturnType<typeof usePreferencesStore>['values']) => void;
    vi.mocked(preferencesApi.set).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await requestClose();
    const request = confirmClose(); await confirmClose();
    await vi.waitFor(() => expect(typeof finish).toBe('function'));
    expect(systemApi.closeApplication).not.toHaveBeenCalled();
    finish(usePreferencesStore().values); await request;
    expect(systemApi.closeApplication).toHaveBeenCalledOnce();
    expect(systemApi.closeApplication).toHaveBeenCalledWith('tray');
  });
  it('retains the visible app when record flushing fails', async () => {
    vi.mocked(flushWorkRecords).mockRejectedValueOnce(new Error('disk unavailable'));
    await requestExit();
    expect(systemApi.closeApplication).not.toHaveBeenCalled();
    expect(closeState.visible).toBe(true);
    expect(closeState.error).toContain('disk unavailable');
  });
  it('uses explicit tray-menu Exit without changing the saved close-button action', async () => {
    await requestExit();
    expect(systemApi.closeApplication).toHaveBeenCalledWith('exit');
    expect(usePreferencesStore().values.close_action).toBe('tray');
  });
});
