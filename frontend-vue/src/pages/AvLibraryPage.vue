<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import LibraryPagination from '../components/shared/LibraryPagination.vue';
import CoverImage from '../components/shared/CoverImage.vue';
import { avCoverOrigin, openCoverDetail, stableDetailPages } from '../features/shell/detailTransition';
import { useDetailCoverTargets } from '../features/shell/useDetailCoverTargets';
import type { AvWork } from '../api/contracts/av';
import { calculateCoverGridLayout } from '../stores/library';
import { useAvLibraryStore } from '../stores/avLibrary';
import { useNavigationStore } from '../stores/navigation';
import { useAccountsStore } from '../stores/accounts';

const library = useAvLibraryStore();
const navigation = useNavigationStore();
const accounts = useAccountsStore();
const covers = useDetailCoverTargets();
const gridElement = ref<HTMLElement | null>(null);
const columns = ref(1), cardWidth = ref(158);
const failedImages = ref(new Set<string>());
let observer: ResizeObserver | null = null;
const active = computed(() => navigation.activePage === 'page-av-library');
const gridStyle = computed(() => ({ '--grid-columns': columns.value, '--grid-card-width': `${cardWidth.value}px` }));
const visiblePaths = computed(() => library.mode === 'code' ? library.pagedWorks.map(work => work.cover) : library.pagedActresses.map(actor => actor.photo));

function measureGrid(): void {
  const grid = gridElement.value;
  if (!grid?.clientWidth || !grid.clientHeight) return;
  const style = getComputedStyle(grid);
  const layout = calculateCoverGridLayout(grid.clientWidth, grid.clientHeight,
    parseFloat(style.paddingLeft) + parseFloat(style.paddingRight), parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
  columns.value = layout.columns; cardWidth.value = layout.cardWidth;
  library.updatePageSize(layout.columns * layout.rows);
}
function image(path: string): string { return failedImages.value.has(path) ? '' : library.imageUrl(path); }
function showActressWorks(name: string): void {
  library.search = name;
  library.mode = 'code';
  library.resetPages();
}
function openDetail(work: AvWork): void {
  void openCoverDetail(avCoverOrigin('av-grid', work.code), async () => library.showDetail(work, 'page-av-library'), { source: 'av', id: work.code });
}

watch([active, () => accounts.locked, () => accounts.selecting], async ([visible, locked, selecting]) => {
  if (!visible || locked || selecting) return;
  await nextTick(); measureGrid();
  if (!active.value || accounts.locked || accounts.selecting) return;
  if (!library.loading) await library.load();
}, { immediate: true });
watch(() => [accounts.current?.key, accounts.locked, accounts.selecting], () => {
  library.resetSession(); failedImages.value.clear();
}, { flush: 'sync' });
watch(visiblePaths, () => { if (active.value) void library.loadVisibleImages(); }, { flush: 'post' });
onMounted(() => {
  observer = new ResizeObserver(measureGrid);
  if (gridElement.value) observer.observe(gridElement.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div id="page-av-library" class="page" :class="{ active, 'home-detail-stable': stableDetailPages }" aria-label="AV">
    <div class="home">
      <div ref="gridElement" class="cover-grid av-cover-grid" :style="gridStyle" :aria-label="library.mode === 'code' ? '番号作品' : '女优照片'">
        <div v-if="library.loading && !library.loaded" class="loading">加载 AV 资料...</div>
        <div v-else-if="library.error" class="empty-state"><h2>加载失败</h2><p>{{ library.error }}</p><button class="btn" @click="library.load">重试</button></div>
        <div v-else-if="!library.totalCount" class="empty-state">
          <h2>{{ library.showClearButton ? '没有符合条件的结果' : '暂无作品' }}</h2>
          <button v-if="library.showClearButton" class="btn" @click="library.clearSearchAndFilters">清除筛选</button>
        </div>
        <template v-else-if="library.mode === 'code'">
          <article v-for="work in library.pagedWorks" :key="work.code" class="cover-card av-work-card" :data-code="work.code" role="button" tabindex="0" :aria-label="`查看 ${work.code} 的作品详情`" @click="openDetail(work)" @keydown.enter="openDetail(work)" @keydown.space.prevent="openDetail(work)">
            <div :ref="el => covers.frame(avCoverOrigin('av-grid', work.code), el)" class="cover-img" :class="{ 'home-detail-cover-hidden': covers.hidden(avCoverOrigin('av-grid', work.code)) }">
              <span class="fluent-icon av-image-placeholder" aria-hidden="true">&#xE714;</span>
              <CoverImage :src="image(work.cover)" :alt="work.code" :jacket="work.cover_layout === 'jacket' || !work.cover_layout" @node="el => covers.image(avCoverOrigin('av-grid', work.code), el)" />
              <span v-if="!work.videos.length" class="av-no-video">no video</span>
              <div class="cover-hover"><div class="ch-title">{{ work.title || work.code }}</div>
                <div class="ch-meta">{{ work.actresses.map(actor => actor.name).join(' / ') }}</div>
                <div class="ch-meta">{{ [work.studio, work.release_date].filter(Boolean).join(' / ') }}</div>
              </div>
            </div>
            <div class="cover-title" :title="work.title">{{ work.code }}</div>
          </article>
        </template>
        <template v-else>
          <button v-for="actor in library.pagedActresses" :key="actor.id" class="cover-card av-actress-card" :data-actress-id="actor.id"
            :aria-label="`${actor.name}，${actor.codes.length} 部作品`" @click="showActressWorks(actor.name)">
            <div class="cover-img">
              <span class="av-image-placeholder av-person-placeholder" aria-hidden="true"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></svg></span>
              <img v-if="image(actor.photo)" :src="image(actor.photo)" :alt="actor.name" class="av-cover-image" loading="lazy" decoding="async" @error="failedImages.add(actor.photo)">
              <div class="cover-hover"><div class="ch-title">{{ actor.name }}</div><div class="ch-meta">{{ actor.codes.length }} 部作品</div></div>
            </div>
            <div class="cover-title">{{ actor.name }}</div>
          </button>
        </template>
      </div>
      <LibraryPagination :current-page="library.currentPage" :total-pages="library.totalPages" :total="library.totalCount"
        :unit="library.mode === 'actress' ? '人' : '部'" @change="library.goPage" />
    </div>
  </div>
</template>

<style scoped>
.av-work-card { cursor: pointer; }
.av-no-video { position: absolute; z-index: 2; top: 7px; right: 7px; padding: 3px 6px; border-radius: 5px; color: #fff; background: rgba(30,34,42,.74); font-size: 10px; line-height: 1.3; pointer-events: none; }
.av-work-card:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; }
.av-actress-card { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: inherit; }
.av-actress-card:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; }
.av-cover-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.av-image-placeholder { color: var(--soft); font-size: 34px; }
.av-person-placeholder { display: grid; place-items: center; }
.empty-state .btn { margin-top: 16px; }
</style>
