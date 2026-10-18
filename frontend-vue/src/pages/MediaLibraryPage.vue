<script setup lang="ts">
import LibraryPagination from '../components/shared/LibraryPagination.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { calculateCoverGridLayout, useLibraryStore } from '../stores/library';
import { useNavigationStore } from '../stores/navigation';

import { coverOrigin, openCoverDetail, stableDetailPages } from '../features/shell/detailTransition';
import { useDetailCoverTargets } from '../features/shell/useDetailCoverTargets';
const covers = useDetailCoverTargets();
const library = useLibraryStore();
const navigation = useNavigationStore();
const gridElement = ref<HTMLElement | null>(null);
const gridColumns = ref(1);
const gridCardWidth = ref(158);
let resizeObserver: ResizeObserver | null = null;
const gridStyle = computed(() => ({
  '--grid-columns': String(gridColumns.value),
  '--grid-card-width': `${gridCardWidth.value}px`,
}));

function measureGrid(preservePosition = true): void {
  const grid = gridElement.value;
  if (!grid || !grid.clientWidth || !grid.clientHeight) return;
  const style = window.getComputedStyle(grid);
  const paddingX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const paddingY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const layout = calculateCoverGridLayout(grid.clientWidth, grid.clientHeight, paddingX, paddingY);
  gridColumns.value = layout.columns;
  gridCardWidth.value = layout.cardWidth;
  library.updatePageSize(layout.columns * layout.rows, preservePosition);
}

function openDetail(id: number): void {
  void openCoverDetail(coverOrigin('media-grid', id), () => library.showDetail(id, 'page-media-library'), { source: 'media', id });
}

function imageError(event: Event): void {
  (event.currentTarget as HTMLImageElement).style.display = 'none';
}

function showWorkMenu(event: MouseEvent, workId?: number): void {
  if (!workId) return;
  library.closeDropdown();
  navigation.showContextMenu(event, 'work', workId);
}

function showHomeMenu(event: MouseEvent): void {
  if ((event.target as Element | null)?.closest('.cover-card')) return;
  library.closeDropdown();
  navigation.showContextMenu(event, 'home');
}

watch(
  () => [navigation.activePage, ...library.pagedWorks.map((work) => work.cover_path || '')],
  ([page]) => {
    if (page === 'page-media-library') void library.loadVisibleCovers();
  },
  { immediate: true, flush: 'post' },
);
watch(() => navigation.activePage, async (page) => {
  if (page !== 'page-media-library') return;
  await nextTick();
  measureGrid(true);
});

onMounted(() => {
  if (gridElement.value) {
    resizeObserver = new ResizeObserver(() => measureGrid(true));
    resizeObserver.observe(gridElement.value);
  }
  measureGrid(false);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});
</script>

<template>
  <div class="page" :class="{ active: navigation.activePage === 'page-media-library', 'home-detail-stable': stableDetailPages }" id="page-media-library">
    <div class="home">
      <div ref="gridElement" class="cover-grid" id="coverGrid" :style="gridStyle" @contextmenu="showHomeMenu">
        <div v-if="library.loading" class="loading">&#128269; 加载作品数据...</div>
        <div v-else-if="library.disconnected" class="empty-state"><h2>Tauri 未连接</h2><p>请在 Tauri 窗口中打开此页面</p></div>
        <div v-else-if="library.error" class="empty-state"><h2>加载失败</h2><p>{{ library.error }}</p></div>
        <div v-else-if="!library.pagedWorks.length" class="empty-state"><h2>暂无作品</h2><p>在设置中扫描目录导入作品</p></div>
        <div v-for="work in library.pagedWorks" :key="work.id" class="cover-card" :data-work-id="work.id" @click="openDetail(Number(work.id))" @contextmenu="showWorkMenu($event, Number(work.id))">
          <div :ref="el => covers.frame(coverOrigin('media-grid', Number(work.id)), el)" class="cover-img" :class="{ 'home-detail-cover-hidden': covers.hidden(coverOrigin('media-grid', Number(work.id))) }">
            <img :ref="el => covers.image(coverOrigin('media-grid', Number(work.id)), el)" v-if="library.coverUrl(work.cover_path)" :src="library.coverUrl(work.cover_path)" style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0" @error="imageError">
            <span style="font-size:36px;color:#bbb">&#127916;</span>
            <div class="cover-hover">
              <div class="ch-title">{{ work.title }}</div>
              <div class="ch-meta">{{ work.studio || '未知制作商' }} / {{ work.year }}-{{ String(work.month).padStart(2, '0') }} / {{ Number(work.episode_count) || 0 }}集</div>
            </div>
          </div>
          <div class="cover-title">{{ work.title }}</div>
        </div>
      </div>
      <LibraryPagination id="pagination" jump-input-id="pageJump" :current-page="library.currentPage" :total-pages="library.totalPages" :total="library.filteredWorks.length" @change="library.goPage" />
    </div>

  </div>
</template>
