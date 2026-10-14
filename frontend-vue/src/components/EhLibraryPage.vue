<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { calculateCoverGridLayout } from "../stores/library";
import { ehDisplayValues, useEhLibraryStore } from "../stores/ehLibrary";
import { useNavigationStore } from "../stores/navigation";
const library = useEhLibraryStore();
const navigation = useNavigationStore();
const gridElement = ref<HTMLElement | null>(null);
const gridColumns = ref(1);
const gridCardWidth = ref(158);
let resizeObserver: ResizeObserver | null = null;
const gridStyle = computed(() => ({
  "--grid-columns": String(gridColumns.value),
  "--grid-card-width": `${gridCardWidth.value}px`,
}));
function measureGrid(): void {
  const grid = gridElement.value;
  if (!grid) return;
  const style = getComputedStyle(grid);
  const layout = calculateCoverGridLayout(
    grid.clientWidth,
    grid.clientHeight,
    parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
    parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
  );
  gridColumns.value = layout.columns;
  gridCardWidth.value = layout.cardWidth;
  library.updatePageSize(layout.columns * layout.rows);
  void library.loadVisibleCovers();
}
function showGalleryMenu(event: MouseEvent, gid: number): void {
  library.closeDropdown();
  navigation.showContextMenu(event, "eh-work", gid);
}
function showEhHomeMenu(event: MouseEvent): void {
  if ((event.target as Element | null)?.closest(".cover-card")) return;
  library.closeDropdown();
  navigation.showContextMenu(event, "eh-home");
}
watch(
  () => navigation.activePage,
  async (page) => {
    if (page === "page-eh-library") {
      await nextTick();
      measureGrid();
    }
  },
);
watch(
  () => library.pagedGalleries.map((gallery) => gallery.cover_path).join("\n"),
  () => void library.loadVisibleCovers(),
  { flush: "post" },
);
onMounted(() => {
  if (gridElement.value) {
    resizeObserver = new ResizeObserver(measureGrid);
    resizeObserver.observe(gridElement.value);
  }
  measureGrid();
});
onBeforeUnmount(() => resizeObserver?.disconnect());
</script>
<template>
  <div
    id="page-eh-library"
    class="page"
    :class="{ active: navigation.activePage === 'page-eh-library' }"
  >
    <div class="home eh-home">
      <div ref="gridElement" class="cover-grid" :style="gridStyle" @contextmenu="showEhHomeMenu">
        <div v-if="library.loading" class="loading">加载书库...</div>
        <div v-else-if="library.error" class="empty-state">
          <h2>书库后端尚未连接</h2>
          <p>{{ library.error }}</p>
        </div>
        <div v-else-if="!library.pagedGalleries.length" class="empty-state">
          <h2>暂无作品</h2>
          <p>在设置中配置 本子库目录并扫描</p>
        </div>
        <div
          v-for="gallery in library.pagedGalleries"
          :key="gallery.gid"
          class="cover-card"
          @click="library.showDetail(gallery)"
          @contextmenu="showGalleryMenu($event, gallery.gid)"
        >
          <div class="cover-img">
            <span v-if="gallery.source === 'hitomi'" class="eh-source-badge">Hitomi</span>
            <img
              v-if="library.coverUrl(gallery.cover_path)"
              :src="library.coverUrl(gallery.cover_path)"
              :alt="gallery.title"
              style="
                width: 100%;
                height: 100%;
                object-fit: cover;
                position: absolute;
                inset: 0;
              "
            /><span
              class="fluent-icon"
              style="font-size: 34px; color: var(--soft)"
              >&#xE82D;</span
            >
            <div class="cover-hover">
              <div class="ch-title">{{ gallery.title }}</div>
              <div class="ch-meta">
                {{
                  ehDisplayValues(gallery, "artist").join(" / ") ||
                  ehDisplayValues(gallery, "group").join(" / ") ||
                  "未知作者"
                }}
                / {{ gallery.pages }}P
              </div>
            </div>
          </div>
          <div class="cover-title">{{ gallery.title }}</div>
        </div>
      </div>
      <div class="pagination">
        <button
          class="page-btn"
          :disabled="library.currentPage <= 1"
          @click="library.goPage(library.currentPage - 1)"
        >
          &#8249;</button
        ><button
          v-for="page in library.totalPages"
          :key="page"
          v-show="
            page === 1 ||
            page === library.totalPages ||
            Math.abs(page - library.currentPage) <= 2
          "
          class="page-num"
          :class="{ active: page === library.currentPage }"
          @click="library.goPage(page)"
        >
          {{ page }}</button
        ><button
          class="page-btn"
          :disabled="library.currentPage >= library.totalPages"
          @click="library.goPage(library.currentPage + 1)"
        >
          &#8250;</button
        ><span class="eh-total"
          >共 {{ library.filteredGalleries.length }} 部</span
        >
      </div>
    </div>
  </div>
</template>
<style scoped>
.eh-home {
  background: var(--bg);
}
.eh-total {
  margin-left: 6px;
  font-size: 11px;
  color: var(--soft);
}
.eh-source-badge {
  position: absolute;
  z-index: 2;
  top: 8px;
  right: 8px;
  padding: 3px 7px;
  border: 1px solid rgba(255,255,255,.35);
  border-radius: 6px;
  background: rgba(20,25,36,.66);
  color: #fff !important;
  font-size: 10px;
  line-height: 1.2;
  backdrop-filter: blur(8px);
}
</style>
