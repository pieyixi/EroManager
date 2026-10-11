<script setup lang="ts">
import { computed, watch } from 'vue';
import { useEhDownloadStore, type DownloadSource, type EhDownloadHistory } from '../stores/ehDownload';
import { useEhLibraryStore } from '../stores/ehLibrary';
import { useNavigationStore } from '../stores/navigation';
import EhDownloadFailurePopover from './EhDownloadFailurePopover.vue';

const props = defineProps<{ source: DownloadSource }>();
const download = useEhDownloadStore();
const library = useEhLibraryStore();
const navigation = useNavigationStore();

const isEh = computed(() => props.source === 'eh');
const queue = computed(() => isEh.value ? download.ehQueue : download.hitomiQueue);
const history = computed(() => (isEh.value ? download.ehHistory : download.hitomiHistory)
  .filter((item) => !queue.value.some((job) => job.id === Math.abs(item.gid))));
const cardCount = computed(() => queue.value.length + history.value.length);
const activeCount = computed(() => queue.value.filter((job) => job.status === 'downloading').length);
const waitingCount = computed(() => queue.value.filter((job) => job.status === 'queued').length);
const message = computed(() => download.messages[props.source]);
const hasAnyMessage = computed(() => Boolean(download.messages.eh || download.messages.hitomi));

function coverPath(gid: number, saved: string): string {
  return saved || library.galleries.find((gallery) => gallery.gid === gid)?.cover_path || '';
}
function coverUrl(gid: number, saved: string): string {
  const path = coverPath(gid, saved);
  return path ? library.coverUrl(path) : '';
}
watch(
  () => [...queue.value.map((job) => coverPath(job.source === 'eh' ? job.id : -job.id, job.coverPath)),
    ...history.value.map((item) => coverPath(item.gid, item.coverPath))].filter(Boolean).join('\n'),
  (paths) => { if (paths) void library.loadCovers(paths.split('\n')); },
  { immediate: true },
);

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
      <div class="eh-download-lane-brand" :class="source"><span>{{ isEh ? 'E' : 'H' }}</span></div>
      <div class="eh-download-lane-heading">
        <h2>{{ isEh ? 'Eh 下载' : 'Hitomi 下载' }}</h2>
        <p>{{ isEh ? 'GID + Token · 下载到当前 Eh 库' : '作品 ID · 下载到当前 Eh 库' }}</p>
      </div>
      <span class="eh-download-lane-count">{{ activeCount }} 下载中 · {{ waitingCount }} 等待</span>
    </header>

    <div class="eh-download-lane-form">
      <div class="eh-download-lane-fields">
        <label><span>{{ isEh ? 'GID' : 'ID' }}</span><input v-if="isEh" v-model="download.ehGidInput" class="s-input" type="text" inputmode="numeric" autocomplete="off" placeholder="输入作品 GID" @keydown.enter.prevent="add"><input v-else v-model="download.hitomiIdInput" class="s-input" type="text" inputmode="numeric" autocomplete="off" placeholder="输入 Hitomi ID" @keydown.enter.prevent="add"></label>
        <label v-if="isEh"><span>Token</span><input v-model="download.ehTokenInput" class="s-input" type="text" autocomplete="off" placeholder="输入该作品 Token" @keydown.enter.prevent="add"></label>
      </div>
      <div class="eh-download-lane-actions"><button class="btn-primary download-clear-button" type="button" @click="download.clearInputs(source)">清除数据</button><button class="btn-primary" type="button" @click="add">加入队列</button></div>
      <div v-if="hasAnyMessage" class="eh-download-lane-feedback" aria-live="polite"><div v-if="message" class="settings-msg" :class="message.kind">{{ message.text }}</div></div>
    </div>

    <section class="eh-download-lane-group" aria-label="作品下载记录">
      <header><h3>作品下载</h3><span>{{ cardCount }} 部</span></header>
      <div v-if="!cardCount" class="eh-download-lane-empty">暂无作品，输入 ID 后加入下载队列</div>
      <div v-else class="eh-download-card-grid">
        <article v-for="job in queue" :key="job.key" class="eh-download-card">
          <div class="eh-download-poster">
            <img v-if="coverUrl(job.source === 'eh' ? job.id : -job.id, job.coverPath)" :src="coverUrl(job.source === 'eh' ? job.id : -job.id, job.coverPath)" :alt="job.title">
            <div v-else class="eh-download-cover-placeholder"><span class="fluent-icon">&#xE82D;</span><small>封面准备中</small></div>
            <span class="eh-download-status-badge" :class="job.status === 'queued' ? 'waiting' : 'active'"><i class="eh-download-status-mark" aria-hidden="true"></i>{{ job.status === 'queued' ? '等待中' : '下载中' }}</span>
          </div>
          <div class="eh-download-card-progress" role="progressbar" :aria-valuenow="job.progressPercent" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${job.progressPercent}%` }"></span></div>
          <div class="eh-download-card-body"><strong :title="job.title">{{ job.title }}</strong><small :title="job.progressText">{{ job.id }} · {{ job.totalPages ? `${job.downloadedPages}/${job.totalPages} 页` : job.progressText }}</small></div>
          <div class="eh-download-card-actions"><button v-if="job.status === 'queued'" class="eh-download-card-action" type="button" @click="download.removeQueued(job.key)">移出队列</button></div>
        </article>
        <article v-for="item in history" :key="item.gid" class="eh-download-card">
          <div class="eh-download-poster">
            <img v-if="coverUrl(item.gid, item.coverPath)" :src="coverUrl(item.gid, item.coverPath)" :alt="item.title">
            <div v-else class="eh-download-cover-placeholder"><span class="fluent-icon">&#xE82D;</span><small>{{ item.error || item.failedPages.length ? '等待补全封面' : '暂无封面' }}</small></div>
            <EhDownloadFailurePopover v-if="item.error || item.failedPages.length" :item="item" @retry-page="(page) => retry(item, page)" />
            <span v-else class="eh-download-status-badge complete"><i class="eh-download-status-mark" aria-hidden="true"></i>下载完成</span>
          </div>
          <div class="eh-download-card-progress is-idle" aria-hidden="true"></div>
          <div class="eh-download-card-body"><strong :title="item.title">{{ item.title }}</strong><small>{{ Math.abs(item.gid) }} · {{ item.totalPages ? `${item.downloadedPages}/${item.totalPages} 页` : '未取得页数' }}</small></div>
          <div class="eh-download-card-actions">
            <button v-if="item.error || item.failedPages.length" class="eh-download-card-action primary" type="button" @click="retry(item)">{{ item.failedPages.length ? '重试失败页' : '重试下载' }}</button>
            <button class="eh-download-card-trash fluent-icon" type="button" :aria-label="`删除 ${item.title} 的记录`" title="删除作品记录" @click="deleteHistory($event, item)">&#xE74D;</button>
          </div>
        </article>
      </div>
    </section>
  </section>
</template>
