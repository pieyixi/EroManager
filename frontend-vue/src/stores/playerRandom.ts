import { defineStore } from 'pinia';
import { accountScope } from '../api/accountContext';
import { accountApi } from '../api/commands/accounts';
import { createDrawPool, recordDraw, type DrawPool } from '../features/home/random';

/** 随机连播独立于主页抽卡；只保存当前账号的作品 ID，不缓存路径、封面或播放队列。 */
export const usePlayerRandomStore = defineStore('playerRandom', {
  state: () => ({ pool: createDrawPool(), owner: '', loaded: false, revision: 0 }),
  actions: {
    async restore(): Promise<void> {
      const owner = accountScope();
      if (this.loaded && this.owner === owner) return;
      const revision = ++this.revision;
      this.loaded = false;
      this.owner = owner;
      this.pool = createDrawPool();
      const raw = await accountApi.get('draw', 'playback', owner);
      if (owner !== accountScope() || revision !== this.revision) return;
      const value = JSON.parse(raw || '{"seen":[],"recent":[]}') as DrawPool;
      if (!Array.isArray(value.seen) || !Array.isArray(value.recent)) throw Error('随机播放记录格式无效');
      const valid = (id: number) => Number.isSafeInteger(id) && id > 0;
      this.pool = { seen: [...new Set(value.seen.filter(valid))], recent: value.recent.filter(valid).slice(-20) };
      this.loaded = true;
    },
    async rememberCurrent(ids: number[], current: number): Promise<void> {
      if (!this.loaded || this.owner !== accountScope() || !ids.includes(current) || this.pool.recent.at(-1) === current) return;
      // 手选作品参与排重但不重置已有轮次；真正随机选中的新作才用 recordDraw 开启下一轮。
      const live = new Set(ids);
      this.pool.seen = [...new Set([...this.pool.seen.filter(id => live.has(id)), current])];
      this.pool.recent = [...this.pool.recent.filter(id => live.has(id) && id !== current), current].slice(-20);
      await this.persist();
    },
    async commit(ids: number[], selected: number): Promise<void> {
      if (!this.loaded || this.owner !== accountScope()) return;
      recordDraw(this.pool, ids, selected);
      await this.persist();
    },
    async persist(): Promise<void> {
      if (this.loaded && this.owner === accountScope()) await accountApi.set('draw', 'playback', JSON.stringify(this.pool), this.owner);
    },
  },
});
