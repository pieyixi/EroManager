import { defineStore } from 'pinia';
import { accountApi } from '../api/commands/accounts';
import { accountScope } from '../api/accountContext';
import type { AccountInfo } from '../api/contracts/accounts';

/** 资料持久化与显示分离；保存完成后仅更新仍属于原账号的界面。 */
export const useProfileStore = defineStore('profile', {
  state: () => ({ key: 0, id: '0001', hasPin: false, nickname: '本地资料库', avatar: '', error: '' }),
  actions: {
    apply(info: AccountInfo | null): void {
      this.key = info?.key || 0; this.id = info?.id || ''; this.hasPin = !!info?.has_pin;
      this.nickname = info?.nickname || ''; this.avatar = info?.avatar || ''; this.error = '';
    },
    async save(nickname: string, avatar: string): Promise<boolean> {
      const key = this.key, scope = accountScope(); this.error = '';
      try {
        await accountApi.profile(nickname, avatar);
        if (this.key === key && accountScope() === scope) { this.nickname = nickname; this.avatar = avatar; }
        return true;
      } catch (error) { if (this.key === key) this.error = `资料未保存：${String(error)}`; return false; }
    },
    rename(value: string): Promise<boolean> { const name = value.trim(); return name ? this.save(name, this.avatar) : Promise.resolve(false); },
    setAvatar(value: string): Promise<boolean> { return this.save(this.nickname, value); },
  },
});
