import { defineStore } from 'pinia';
import { watch } from 'vue';
import { preferencesApi } from '../api/commands/preferences';
import { defaultPreferences, type ApplicationInfo, type UserPreferences } from '../api/contracts/preferences';

export const usePreferencesStore = defineStore('preferences', {
  state: () => ({ values: defaultPreferences(), loaded: false, loading: false, saving: false,
    error: '', revision: 0, savedRevision: 0, info: null as ApplicationInfo | null }),
  actions: {
    async flush(): Promise<void> {
      if (this.saving) await new Promise<void>(resolve => {
        const stop = watch(() => this.saving, saving => { if (!saving) { stop(); resolve(); } });
      });
      await this.save();
      if (!this.loaded || this.error) throw new Error(this.error || '偏好尚未载入');
    },
    async load(): Promise<void> {
      if (this.loading || this.loaded) return;
      this.loading = true;
      try {
        this.values = await preferencesApi.get();
        this.loaded = true;
        this.error = '';
        void preferencesApi.info().then(info => { this.info = info; }).catch(() => undefined);
      } catch (error) { this.error = `偏好读取失败：${String(error)}`; }
      finally { this.loading = false; }
    },
    update(patch: Partial<UserPreferences>): void {
      if (!this.loaded) return;
      this.values = { ...this.values, ...patch };
      this.revision += 1;
      void this.save();
    },
    async save(): Promise<void> {
      if (this.saving || !this.loaded) return;
      this.saving = true;
      try {
        // 串行合并快速输入，旧响应只确认自己的版本，不覆盖后续输入。
        while (this.savedRevision !== this.revision) {
          const version = this.revision;
          await preferencesApi.set({ ...this.values });
          this.savedRevision = version;
        }
        this.error = '';
      } catch (error) { this.error = `偏好尚未保存：${String(error)}`; }
      finally { this.saving = false; }
    },
    async reset(): Promise<void> {
      if (this.saving || this.loading) return;
      this.saving = true;
      try {
        this.values = await preferencesApi.set({ ...defaultPreferences(), theme: 'light' });
        this.loaded = true;
        this.savedRevision = ++this.revision;
        this.error = '';
      } catch (error) { this.error = `恢复默认偏好失败：${String(error)}`; }
      finally { this.saving = false; }
    },
  },
});
