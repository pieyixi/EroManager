<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { useEhDownloadStore } from '../../stores/ehDownload';
import { useNavigationStore } from '../../stores/navigation';
import { usePreferencesStore } from '../../stores/preferences';
const download = useEhDownloadStore();
const navigation = useNavigationStore();
const preferences = usePreferencesStore();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
function dismiss(key: string): void {
  clearTimeout(timers.get(key)); timers.delete(key);
  download.notices = download.notices.filter(notice => notice.key !== key);
}
watch(() => download.notices.map(notice => notice.key), keys => {
  for (const [key, timer] of timers) if (!keys.includes(key)) { clearTimeout(timer); timers.delete(key); }
  for (const key of keys) if (!timers.has(key)) timers.set(key, setTimeout(() => dismiss(key), 6500));
});
watch(() => preferences.values.download_notify, enabled => { if (!enabled) download.notices = []; });
onBeforeUnmount(() => timers.forEach(timer => clearTimeout(timer)));
</script>
<template>
  <div class="download-notices" aria-live="polite">
    <article v-for="notice in download.notices" :key="notice.key" class="download-notice">
      <i :class="{ failed: notice.failed }" aria-hidden="true"></i>
      <div><strong>{{ notice.source === 'eh' ? 'Eh' : 'Hitomi' }} · {{ notice.failed ? '下载未完成' : '下载完成' }}</strong><p>{{ notice.title }}</p><button @click="navigation.showPage('page-eh-download'); dismiss(notice.key)">查看下载</button></div>
      <button class="download-notice-close" aria-label="关闭下载提示" @click="dismiss(notice.key)">×</button>
    </article>
  </div>
</template>
<style scoped>
.download-notices{position:fixed;z-index:11000;top:80px;right:22px;width:320px;max-width:calc(100vw - 44px);display:grid;gap:10px;pointer-events:none}
.download-notice{display:flex;gap:12px;align-items:flex-start;padding:17px;background:var(--panel);border:1px solid var(--line);border-radius:9px;box-shadow:0 9px 32px rgba(0,0,0,.13);pointer-events:auto;animation:notice-in .2s ease both}
.download-notice>i{width:7px;height:7px;flex:0 0 7px;border-radius:50%;margin-top:5px;background:#39a773}.download-notice>i.failed{background:#dd5c62}.download-notice>div{min-width:0;flex:1}.download-notice strong{font-size:13px;font-weight:600;color:var(--text-strong)}.download-notice p{font-size:12px;line-height:1.6;margin:6px 0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:var(--muted)}.download-notice button{border:0;background:transparent;color:var(--primary);font-size:12px;cursor:pointer;padding:0}.download-notice .download-notice-close{color:var(--muted);font-size:19px;line-height:1;padding:0 2px}
@keyframes notice-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
</style>
