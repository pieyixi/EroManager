<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAvDownloadStore } from '../../stores/avDownload';
import { useAvLibraryStore } from '../../stores/avLibrary';
import { useNavigationStore } from '../../stores/navigation';
import { useAccountsStore } from '../../stores/accounts';
import { avCoverOrigin, openCoverDetail } from '../../features/shell/detailTransition';
import { useDetailCoverTargets } from '../../features/shell/useDetailCoverTargets';
import { usePageScrollPosition } from '../../features/shell/usePageScrollPosition';
import CoverImage from '../shared/CoverImage.vue';
import type { AvFetchJob } from '../../stores/avDownload';

const props = defineProps<{ active: boolean }>();
const download = useAvDownloadStore(), library = useAvLibraryStore(), navigation = useNavigationStore(), accounts = useAccountsStore();
const resultsElement = ref<HTMLElement | null>(null);
const covers = useDetailCoverTargets(resultsElement);
usePageScrollPosition('page-eh-download', resultsElement, () => props.active);
watch(() => [props.active, navigation.activePage, accounts.locked, accounts.current?.key, download.binding], () => {
  if (props.active && navigation.activePage === 'page-eh-download' && !accounts.locked) void download.initialize();
}, { immediate: true });
const paths = computed(() => download.cards.map(job => job.work?.cover || '').filter(Boolean));
watch(paths, paths => { if (props.active) void library.loadImages(paths); }, { immediate: true });
watch(() => props.active, active => { if (active) void library.loadImages(paths.value); });
function openDetail(job: AvFetchJob): void {
  if (!job.work) return;
  const work = job.work;
  void openCoverDetail(avCoverOrigin('av-download', work.code), async () => library.showDetail(library.works.find(item => item.code === work.code) || work, 'page-eh-download'), { source: 'av', id: work.code });
}
</script>
<template>
  <section class="eh-download-lane" aria-label="JavDB 获取">
    <div class="eh-download-lane-form">
      <div class="eh-download-lane-fields">
        <label><span>番号</span><input v-model="download.input" class="s-input" aria-label="番号" placeholder="IPX-607" autocomplete="off" @keydown.enter.prevent="download.enqueue"></label>
      </div>
      <div class="eh-download-lane-actions"><button class="btn-primary download-clear-button" @click="download.clearInputs">清除数据</button><button class="btn-primary" :disabled="download.binding" @click="download.enqueue">加入队列</button></div>
    </div>
    <p v-if="download.error" class="av-fetch-error">{{ download.error }}</p>
    <section class="eh-download-lane-group" aria-label="JavDB 获取记录">
      <header><h3>资料获取</h3><span>{{ download.cards.length }} 部</span></header>
      <div ref="resultsElement" class="eh-download-lane-results">
        <div v-if="!download.cards.length" class="eh-download-lane-empty">输入番号，获取作品资料</div>
        <div v-else class="eh-download-card-grid">
          <article v-for="job in download.cards" :key="job.code" class="eh-download-card" :data-code="job.code">
            <div :ref="el => covers.frame(avCoverOrigin('av-download', job.code), el)" class="eh-download-poster" :class="{ 'home-detail-cover-hidden': covers.hidden(avCoverOrigin('av-download', job.code)) }">
              <CoverImage :src="library.imageUrl(job.work?.cover || '')" :alt="job.code" :jacket="job.work?.cover_layout !== 'portrait'" @node="el => covers.image(avCoverOrigin('av-download', job.code), el)" />
              <div v-if="!library.imageUrl(job.work?.cover || '')" class="eh-download-cover-placeholder"><span class="fluent-icon">&#xE714;</span><small>{{ job.status === 'failed' ? '等待补全封面' : '封面准备中' }}</small></div>
              <button v-if="job.work" class="eh-download-cover-link" :aria-label="`查看 ${job.code} 的作品详情`" @click="openDetail(job)"></button>
              <span class="eh-download-status-badge" :class="job.status === 'complete' ? (job.warnings.length ? 'failed' : 'complete') : job.status === 'failed' ? 'failed' : job.status === 'fetching' ? 'active' : 'waiting'"><i class="eh-download-status-mark"></i>{{ job.status === 'complete' ? (job.warnings.length ? '部分图片失败' : '获取完成') : job.status === 'failed' ? '获取失败' : job.status === 'fetching' ? '获取中' : '等待中' }}</span>
            </div>
            <div class="eh-download-card-progress" :class="{ 'is-idle': job.status === 'complete' || job.status === 'failed' }"><span class="av-fetch-progress" :class="{ running: job.status === 'fetching' }"></span></div>
            <div class="eh-download-card-body"><strong :title="job.work?.title || job.code">{{ job.code }} {{ job.work?.title }}</strong><small :title="job.error || job.warnings.join('\n')">{{ job.error || (job.warnings.length ? job.warnings.join('；') : job.work?.release_date || '等待获取资料') }}</small></div>
            <div class="eh-download-card-actions"><button v-if="job.status === 'failed' || job.warnings.length" class="eh-download-card-action primary" @click="download.retry(job.code)">重试获取</button><button v-else-if="job.status === 'queued'" class="eh-download-card-action" @click="download.removeQueued(job.code)">移出队列</button></div>
          </article>
        </div>
      </div>
    </section>
  </section>
</template>
<style scoped>
.av-fetch-error { color: var(--danger); font-size: 12px; margin-top: 9px; }
.av-fetch-progress.running { width: 35%; animation: avFetchProgress 1.2s ease-in-out infinite alternate; }
@keyframes avFetchProgress { to { transform: translateX(185%); } }
</style>
