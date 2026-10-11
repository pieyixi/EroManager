<script setup lang="ts">
import { watch } from 'vue';
import { useEhLibraryStore } from '../stores/ehLibrary';
import { useNavigationStore } from '../stores/navigation';
import EhDownloadLane from './EhDownloadLane.vue';

const navigation = useNavigationStore();
const library = useEhLibraryStore();

watch(() => navigation.activePage, (page) => {
  if (page === 'page-eh-download' && !library.overview && !library.loading) void library.load();
}, { immediate: true });
</script>

<template>
  <div id="page-eh-download" class="page" :class="{ active: navigation.activePage === 'page-eh-download' }">
    <div class="eh-download-workspace">
      <div class="eh-download-lanes">
        <EhDownloadLane source="eh" />
        <EhDownloadLane source="hitomi" />
      </div>
    </div>
  </div>
</template>
