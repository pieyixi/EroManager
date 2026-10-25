<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { stableDetailPages } from '../features/shell/detailTransition';
import { usePageScrollPosition } from '../features/shell/usePageScrollPosition';
import { useEhLibraryStore } from '../stores/ehLibrary';
import { useNavigationStore } from '../stores/navigation';
import { useEhDownloadStore } from '../stores/ehDownload';
import EhDownloadLane from '../components/downloads/EhDownloadLane.vue';
import JavdbFetchLane from '../components/downloads/JavdbFetchLane.vue';
import { useAvDownloadStore } from '../stores/avDownload';

const pageElement = ref<HTMLElement | null>(null);
usePageScrollPosition('page-eh-download', pageElement);
const navigation = useNavigationStore();
const library = useEhLibraryStore();
const download = useEhDownloadStore();
const avDownload = useAvDownloadStore();
const tabs = [
  { key: 'eh', label: 'Eh 下载' },
  { key: 'hitomi', label: 'Hitomi 下载' },
  { key: 'javdb', label: 'JavDB 获取' },
] as const;
const activeTab = ref<typeof tabs[number]['key']>('eh');
const tabElements = ref<HTMLButtonElement[]>([]);
const queue = computed(() => activeTab.value === 'eh' ? download.ehQueue : download.hitomiQueue);
const activeCount = computed(() => queue.value.filter(job => job.status === 'downloading').length);
const waitingCount = computed(() => queue.value.filter(job => job.status === 'queued').length);

function tabKeydown(event: KeyboardEvent): void {
  const index = tabs.findIndex(tab => tab.key === activeTab.value);
  const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
    : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
    : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault();
  activeTab.value = tabs[next]!.key;
  void nextTick(() => tabElements.value[next]?.focus());
}

watch(() => navigation.activePage, (page) => {
  if (page === 'page-eh-download' && !library.overview && !library.loading) void library.load();
}, { immediate: true });
</script>

<template>
  <div ref="pageElement" id="page-eh-download" class="page" :class="{ active: navigation.activePage === 'page-eh-download', 'home-detail-stable': stableDetailPages }">
    <div class="eh-download-workspace">
      <div class="eh-download-lanes">
        <header class="eh-download-tabbar">
          <nav class="eh-download-tabs" role="tablist" aria-label="下载来源" @keydown="tabKeydown">
            <button v-for="tab in tabs" :id="`download-tab-${tab.key}`" :key="tab.key" ref="tabElements"
              class="eh-download-tab" :class="{ active: activeTab === tab.key }" type="button" role="tab"
              :aria-selected="activeTab === tab.key" :aria-controls="`download-panel-${tab.key}`"
              :tabindex="activeTab === tab.key ? 0 : -1" @click="activeTab = tab.key">{{ tab.label }}</button>
          </nav>
          <span class="eh-download-lane-count">{{ activeTab === 'javdb' ? avDownload.activeCount : activeCount }} {{ activeTab === 'javdb' ? '获取中' : '下载中' }} · {{ activeTab === 'javdb' ? avDownload.waitingCount : waitingCount }} 等待</span>
        </header>
        <EhDownloadLane id="download-panel-eh" v-show="activeTab === 'eh'" source="eh" :active="activeTab === 'eh'" role="tabpanel" aria-labelledby="download-tab-eh" />
        <EhDownloadLane id="download-panel-hitomi" v-show="activeTab === 'hitomi'" source="hitomi" :active="activeTab === 'hitomi'" role="tabpanel" aria-labelledby="download-tab-hitomi" />
        <JavdbFetchLane id="download-panel-javdb" v-show="activeTab === 'javdb'" :active="activeTab === 'javdb'" role="tabpanel" aria-labelledby="download-tab-javdb" />
      </div>
    </div>
  </div>
</template>
