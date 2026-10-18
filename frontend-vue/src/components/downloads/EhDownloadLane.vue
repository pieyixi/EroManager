<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { coverOrigin, openCoverDetail } from '../../features/shell/detailTransition';
import { useDetailCoverTargets } from '../../features/shell/useDetailCoverTargets';
import { usePageScrollPosition } from '../../features/shell/usePageScrollPosition';
import { isDownloadComplete, useEhDownloadStore, type DownloadSource, type EhDownloadHistory } from '../../stores/ehDownload';
import { useEhLibraryStore } from '../../stores/ehLibrary';
import { useNavigationStore } from '../../stores/navigation';
import EhDownloadFailurePopover from './EhDownloadFailurePopover.vue';

const covers = useDetailCoverTargets();
const resultsElement = ref<HTMLElement | null>(null);
usePageScrollPosition('page-eh-download', resultsElement);
const props = defineProps<{ source: DownloadSource }>();
const download = useEhDownloadStore();
const library = useEhLibraryStore();
const navigation = useNavigationStore();

const isEh = computed(() => props.source === 'eh');
const queue = computed(() => isEh.value ? download.ehQueue : download.hitomiQueue);
const cards = computed(() => download.cards.filter((card) => card.source === props.source));
const cardCount = computed(() => cards.value.length);
const activeCount = computed(() => queue.value.filter((job) => job.status === 'downloading').length);
const waitingCount = computed(() => queue.value.filter((job) => job.status === 'queued').length);

function coverPath(gid: number, saved: string): string {
  return saved || library.galleries.find((gallery) => gallery.gid === gid)?.cover_path || '';
}
function coverUrl(gid: number, saved: string): string {
  const path = coverPath(gid, saved);
  return path ? library.coverUrl(path) : '';
}
watch(
  () => cards.value.map((card) => coverPath(card.gid,
    card.kind === 'queue' ? card.job.coverPath : card.item.coverPath)).filter(Boolean).join('\n'),
  (paths) => { if (paths) void library.loadCovers(paths.split('\n')); },
  { immediate: true },
);

function openDetail(gid: number): void {
  void openCoverDetail(coverOrigin('download', gid), () => download.openCompletedGallery(gid), { source: 'book', id: gid });
}
function add(): void {
  if (isEh.value) download.enqueueEh();
  else download.enqueueHitomi();
}
function retry(item: EhDownloadHistory, page?: number): void {
  download.retryHistoryPages(item, page === undefined ? item.failedPages : [page]);
}
function deleteHistory(event: MouseEvent, item: EhDownloadHistory): void {
  if (!item.folderPath) { void download.forgetHistory(item.gid); return; }
  navigation.showContextMenu(event, 'eh-history', item.gid);
}
</script>

<template>
  <section class="eh-download-lane" :aria-label="isEh ? 'Eh 下载' : 'Hitomi 下载'">
    <header class="eh-download-lane-head">
      <div class="eh-download-lane-heading">
        <h2>{{ isEh ? 'Eh 下载' : 'Hitomi 下载' }}</h2>
      </div>
      <span class="eh-download-lane-count">{{ activeCount }} 下载中 · {{ waitingCount }} 等待</span>
    </header>

    <div class="eh-download-lane-form">
      <div class="eh-download-lane-fields">
        <label><span>{{ isEh ? 'GID' : 'ID' }}</span><input v-if="isEh" v-model="download.ehGidInput" class="s-input" type="text" inputmode="numeric" autocomplete="off" @keydown.enter.prevent="add"><input v-else v-model="download.hitomiIdInput" class="s-input" type="text" inputmode="numeric" autocomplete="off" @keydown.enter.prevent="add"></label>
        <label v-if="isEh"><span>Token</span><input v-model="download.ehTokenInput" class="s-input" type="text" autocomplete="off" @keydown.enter.prevent="add"></label>
      </div>
      <div class="eh-download-lane-actions"><button class="btn-primary download-clear-button" type="button" @click="download.clearInputs(source)">清除数据</button><button class="btn-primary" type="button" @click="add">加入队列</button></div>
    </div>

    <section class="eh-download-lane-group" aria-label="作品下载记录">
      <header><h3>作品下载</h3><span>{{ cardCount }} 部</span></header>
      <div ref="resultsElement" class="eh-download-lane-results">
      <div v-if="!cardCount" class="eh-download-lane-empty">暂无作品，输入 ID 后加入下载队列</div>
      <div v-else class="eh-download-card-grid">
        <article v-for="card in cards" :key="card.key" :data-gid="card.gid" class="eh-download-card">
          <template v-if="card.kind === 'queue'">
          <div class="eh-download-poster">
            <img v-if="coverUrl(card.gid, card.job.coverPath)" :src="coverUrl(card.gid, card.job.coverPath)" :alt="card.job.title">
            <div v-else class="eh-download-cover-placeholder"><span class="fluent-icon">&#xE82D;</span><small>封面准备中</small></div>
            <span class="eh-download-status-badge" :class="card.job.status === 'queued' ? 'waiting' : 'active'"><i class="eh-download-status-mark" aria-hidden="true"></i>{{ card.job.status === 'queued' ? '等待中' : '下载中' }}</span>
          </div>
          <div class="eh-download-card-progress" role="progressbar" :aria-valuenow="card.job.progressPercent" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${card.job.progressPercent}%` }"></span></div>
          <div class="eh-download-card-body"><strong :title="card.job.title">{{ card.job.title }}</strong><small :title="card.job.progressText">{{ card.job.id }} · {{ card.job.totalPages ? `${card.job.downloadedPages}/${card.job.totalPages} 页` : card.job.progressText }}</small></div>
          <div class="eh-download-card-actions"><button v-if="card.job.status === 'queued'" class="eh-download-card-action" type="button" @click="download.removeQueued(card.job.key)">移出队列</button></div>
          </template>
          <template v-else>
          <div :ref="el => covers.frame(coverOrigin('download', card.gid), el)" class="eh-download-poster" :class="{ 'home-detail-cover-hidden': covers.hidden(coverOrigin('download', card.gid)) }">
            <img :ref="el => covers.image(coverOrigin('download', card.gid), el)" v-if="coverUrl(card.gid, card.item.coverPath)" :src="coverUrl(card.gid, card.item.coverPath)" :alt="card.item.title">
            <div v-else class="eh-download-cover-placeholder"><span class="fluent-icon">&#xE82D;</span><small>{{ card.item.error || card.item.failedPages.length ? '等待补全封面' : '暂无封面' }}</small></div>
            <button v-if="isDownloadComplete(card.item)" class="eh-download-cover-link" type="button" :aria-label="`查看 ${card.item.title} 的作品详情`" title="查看作品详情" @click="openDetail(card.gid)"></button>
            <EhDownloadFailurePopover v-if="card.item.error || card.item.failedPages.length" :item="card.item" @retry-page="(page) => retry(card.item, page)" />
            <span v-else class="eh-download-status-badge complete"><i class="eh-download-status-mark" aria-hidden="true"></i>下载完成</span>
          </div>
          <div class="eh-download-card-progress is-idle" aria-hidden="true"></div>
          <div class="eh-download-card-body"><strong :title="card.item.title">{{ card.item.title }}</strong><small>{{ Math.abs(card.gid) }} · {{ card.item.totalPages ? `${card.item.downloadedPages}/${card.item.totalPages} 页` : '未取得页数' }}</small></div>
          <div class="eh-download-card-actions">
            <button v-if="card.item.error || card.item.failedPages.length" class="eh-download-card-action primary" type="button" @click="retry(card.item)">{{ card.item.failedPages.length ? '重试失败页' : '重试下载' }}</button>
            <button class="eh-download-card-trash fluent-icon" type="button" :aria-label="`删除 ${card.item.title} 的记录`" title="删除作品记录" @click="deleteHistory($event, card.item)">&#xE74D;</button>
          </div>
          </template>
        </article>
      </div>
      </div>
    </section>
  </section>
</template>
