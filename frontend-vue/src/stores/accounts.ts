import { defineStore } from 'pinia';
import { accountApi } from '../api/commands/accounts';
import { setAccountScope } from '../api/accountContext';
import { accountScope } from '../api/accountContext';
import { defaultPrivacy, normalizePrivacy, type AccountInfo, type AccountState, type PrivacySettings } from '../api/contracts/accounts';
import { useProfileStore } from './profile';

export const useAccountsStore = defineStore('accounts', {
  state: () => ({ initialized: false, personalKey: 0, locked: false, selecting: false, switching: false, busy: false,
    error: '', accounts: [] as AccountInfo[], current: null as AccountInfo | null,
    privacy: defaultPrivacy(), privacyRevision: 0, privacyError: '' }),
  actions: {
    apply(state: AccountState): void {
      this.accounts = state.accounts; this.current = state.current; this.locked = state.locked;
      this.selecting = state.locked && !state.current;
      setAccountScope(state.scope);
      useProfileStore().apply(state.current);
      this.initialized = true;
    },
    async initialize(): Promise<void> {
      this.error = '';
      try { this.apply(await accountApi.state()); }
      catch (error) { this.initialized = true; this.locked = true; this.error = String(error); throw error; }
    },
    async loadPrivacy(): Promise<void> {
      const owner = accountScope(), revision = ++this.privacyRevision;
      const value = await accountApi.get('privacy');
      if (owner !== accountScope() || revision !== this.privacyRevision) return;
      const previous = { ...defaultPrivacy(), ...JSON.parse(value || '{}') } as PrivacySettings;
      this.privacy = normalizePrivacy(previous);
      // 删除旧自定义/短后台选项后将对应旧值关闭，界面与实际计时保持一致。
      if (previous.idle_seconds !== this.privacy.idle_seconds || previous.background_seconds !== this.privacy.background_seconds) {
        await accountApi.set('privacy', '', JSON.stringify(this.privacy), owner);
      }
    },
    async savePrivacy(patch: Partial<PrivacySettings>): Promise<void> {
      const next = { ...this.privacy, ...patch };
      const revision = ++this.privacyRevision;
      const owner = accountScope();
      this.privacy = next;
      this.privacyError = '';
      try { await accountApi.set('privacy', '', JSON.stringify(next)); }
      catch (error) { if (owner === accountScope() && revision === this.privacyRevision) this.privacyError = `隐私设置未保存：${String(error)}`; }
    },
  },
});
