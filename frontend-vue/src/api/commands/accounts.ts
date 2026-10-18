import { invokeTauri } from '../tauri';
import { accountScope, rememberAccountPin, trackAccountWrite } from '../accountContext';
import type { AccountState } from '../contracts/accounts';
const dataWrites = new Map<string, Promise<void>>();
function setData(kind: 'privacy' | 'draw', item: string, value: string, scope = accountScope()): Promise<void> {
  const key = `${scope}:${kind}:${item}`;
  const request = (dataWrites.get(key) || Promise.resolve()).catch(() => undefined)
    .then(() => invokeTauri<void>('account_set_data', { scope, kind, item, value }));
  dataWrites.set(key, request);
  void request.finally(() => { if (dataWrites.get(key) === request) dataWrites.delete(key); }).catch(() => undefined);
  return trackAccountWrite(request);
}

export const accountApi = {
  state: () => invokeTauri<AccountState>('account_state'),
  auth: (id: string, pin: string) => invokeTauri<AccountState>('account_auth', { id, pin }),
  lock: () => invokeTauri<void>('account_lock'),
  logout: () => invokeTauri<void>('account_logout'),
  profile: (nickname: string, avatar: string) => trackAccountWrite(invokeTauri<void>('account_update_profile', { scope: accountScope(), nickname, avatar })),
  pin: (newPin: string) => {
    const scope = accountScope();
    return trackAccountWrite(invokeTauri<void>('account_change_pin', { scope, newPin }).then(() => rememberAccountPin(newPin, scope)));
  },
  get: (kind: 'privacy' | 'draw', item = '', scope = accountScope()) => invokeTauri<string | null>('account_get_data', { scope, kind, item }),
  set: setData,
};
