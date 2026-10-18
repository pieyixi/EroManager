<script setup lang="ts">
import { ref, watch } from 'vue';
import { stableDetailPages } from '../features/shell/detailTransition';
import { usePageScrollPosition } from '../features/shell/usePageScrollPosition';
import { useEhLibraryStore } from '../stores/ehLibrary';
import { useNavigationStore } from '../stores/navigation';
import EhDownloadLane from '../components/downloads/EhDownloadLane.vue';

const pageElement = ref<HTMLElement | null>(null);
usePageScrollPosition('page-eh-download', pageElement);
const navigation = useNavigationStore();
const library = useEhLibraryStore();

watch(() => navigation.activePage, (page) => {
  if (page === 'page-eh-download' && !library.overview && !library.loading) void library.load();
}, { immediate: true });
</script>

<template>
  <div ref="pageElement" id="page-eh-download" class="page" :class="{ active: navigation.activePage === 'page-eh-download', 'home-detail-stable': stableDetailPages }">
    <div class="eh-download-workspace">
      <div class="eh-download-lanes">
        <EhDownloadLane source="eh" />
        <EhDownloadLane source="hitomi" />
      </div>
    </div>
  </div>
</template>
