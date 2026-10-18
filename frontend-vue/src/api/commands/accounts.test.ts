import { beforeEach, describe, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../tauri', () => ({ invokeTauri: invoke }));
import { accountApi } from './accounts';
import { accountPin, setAccountScope, flushAccountWrites } from '../accountContext';

beforeEach(() => { invoke.mockReset(); setAccountScope(''); setAccountScope('old-session'); });
describe('account request ownership', () => {
  it('tracks inline PIN changes under the currently authenticated scope', async () => {
    let finish!: () => void;
    invoke.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const write = accountApi.pin('0123'); let flushed = false;
    const flush = flushAccountWrites().then(() => { flushed = true; });
    setAccountScope('new-session'); await Promise.resolve();
    expect(flushed).toBe(false);
    expect(invoke).toHaveBeenCalledWith('account_change_pin', { scope: 'old-session', newPin: '0123' });
    finish(); await write; await flush; expect(flushed).toBe(true); expect(accountPin()).toBe('');
  });
  it('displays only successfully saved PINs in the current session and clears them on disable or account change', async () => {
    invoke.mockResolvedValue(undefined);
    await accountApi.pin('0123'); expect(accountPin()).toBe('0123');
    invoke.mockRejectedValueOnce(new Error('write failed'));
    await expect(accountApi.pin('4567')).rejects.toThrow('write failed'); expect(accountPin()).toBe('0123');
    await accountApi.pin(''); expect(accountPin()).toBe('');
    await accountApi.pin('4567'); setAccountScope('new-session'); expect(accountPin()).toBe('');
  });
  it('serializes snapshots and captures scope before queued work starts', async () => {
    let finish!: () => void;
    invoke.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const first = accountApi.set('draw', 'media', '{"seen":[1],"recent":[1]}');
    const second = accountApi.set('draw', 'media', '{"seen":[1,2],"recent":[1,2]}');
    await Promise.resolve(); await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);
    setAccountScope('new-session'); finish(); await first; await second; await flushAccountWrites();
    expect(invoke.mock.calls[1][1].scope).toBe('old-session');
    expect(invoke.mock.calls[1][1].value).toContain('1,2');
  });
});
