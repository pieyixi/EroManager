import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
const native = vi.hoisted(() => ({ callback: undefined as undefined | ((force: boolean) => void), stop: vi.fn(), obscure: vi.fn(), state: vi.fn() }));
vi.mock('../../api/tauri', () => ({ listenTauri: async (_: string, callback: (force: boolean) => void) => { native.callback = callback; return native.stop; } }));
vi.mock('../../api/commands/accounts', () => ({ accountApi: { state: native.state } }));
vi.mock('./controller', () => ({ obscureNativePlayer: native.obscure }));
import { installAccountAdminUpdates } from './adminUpdates';
import { useAccountsStore } from '../../stores/accounts';
import { useHomeStore } from '../../stores/home';
import { useProfileStore } from '../../stores/profile';
import { accountScope } from '../../api/accountContext';
const user = { key: 2, id: '0001', nickname: '原昵称', avatar: '', has_pin: false };
const snapshot = (locked = false) => ({ accounts: [user], current: user, scope: locked ? '' : 'scope-a', locked, last_id: '0001' });
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
describe('external account management', () => {
  let stop: () => void;
  beforeEach(async () => { vi.clearAllMocks(); setActivePinia(createPinia()); native.obscure.mockResolvedValue(undefined); useAccountsStore().apply(snapshot()); stop = installAccountAdminUpdates(); await settle(); });
  afterEach(() => stop());
  it('refreshes identity and account choices without dropping the active session or selection UI', async () => {
    useAccountsStore().selecting = true;
    native.state.mockResolvedValue({ ...snapshot(), current: { ...user, id: '0088', nickname: '新昵称' } });
    native.callback!(false); await settle();
    expect(useProfileStore().id).toBe('0088'); expect(useProfileStore().nickname).toBe('新昵称');
    expect(accountScope()).toBe('scope-a'); expect(useAccountsStore().selecting).toBe(true); expect(native.obscure).not.toHaveBeenCalled();
  });
  it('immediately blocks old content and scope, then handles deletion with an account picker', async () => {
    let finish!: (value: unknown) => void; native.state.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    useHomeStore().enabled = true; native.callback!(true); await settle();
    expect(useAccountsStore().locked).toBe(true); expect(accountScope()).toBe(''); expect(useHomeStore().enabled).toBe(false); expect(native.obscure).toHaveBeenCalledTimes(1);
    finish({ ...snapshot(true), current: null, accounts: [{ ...user, key: 3, id: '0002' }] }); await settle();
    expect(useAccountsStore().selecting).toBe(true); expect(useProfileStore().key).toBe(0);
  });
  it('does not accept replies after disposal and releases subscriptions', async () => {
    let finish!: (value: unknown) => void; native.state.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    native.callback!(false); await settle(); stop(); finish({ ...snapshot(), current: { ...user, nickname: '不应覆盖' } }); await settle();
    expect(useProfileStore().nickname).toBe('原昵称'); expect(native.stop).toHaveBeenCalled();
  });
  it('revokes immediately even behind a pending list request, then reads a fresh snapshot', async () => {
    let finish!: (value: unknown) => void;
    native.state.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(snapshot(true));
    native.callback!(false); await settle(); native.callback!(true);
    expect(useAccountsStore().locked).toBe(true); expect(accountScope()).toBe(''); expect(native.obscure).toHaveBeenCalledTimes(1);
    finish(snapshot()); await settle();
    expect(native.state).toHaveBeenCalledTimes(2); expect(useAccountsStore().locked).toBe(true); expect(accountScope()).toBe('');
  });
});
