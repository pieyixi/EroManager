<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { currentTauriWindow, type TauriWindowHandle } from "../api/tauri";
import { useArchiveStore } from "../stores/archive";
import { type DropdownPosition, type FilterKey, useLibraryStore } from "../stores/library";
import { useNavigationStore } from "../stores/navigation";
import { type EhFilterKey, useEhLibraryStore } from "../stores/ehLibrary";
import { useLibraryConsoleStore } from "../stores/libraryConsole";
import { useUiStore } from "../stores/ui";
import ShellBackButton from "./ShellBackButton.vue";
import ShellFilterDropdowns from "./ShellFilterDropdowns.vue";
import WindowControls from "./WindowControls.vue";

const navigation = useNavigationStore();
const ehLibrary = useEhLibraryStore();
const library = useLibraryStore();
const archive = useArchiveStore();
const settings = useLibraryConsoleStore();
const ui = useUiStore();
const searchElement = ref<HTMLInputElement | null>(null);
const searchContainer = ref<HTMLElement | null>(null);
const searchExpanded = ref(false);
const ehDropdownPosition = ref({ top: 0, left: 0, width: 310 });
const maximized = ref(false);
let appWindow: TauriWindowHandle | null = null;
let stopResize: (() => void) | null = null;

const ehFilterLabels: Record<EhFilterKey, string> = {
  category: "分类",
  artist: "画师",
  group: "社团",
  tag: "Tag",
};

const isHome = computed(() => navigation.activePage === "page-home");
const isEh = computed(() => navigation.activePage === "page-eh-library");
const isBrowsePage = computed(() => isHome.value || isEh.value);
const isPlayer = computed(() => navigation.activePage === "page-player");
const isReader = computed(() => navigation.activePage === "page-eh-reader");
const isImmersive = computed(() => isPlayer.value || isReader.value);
const pageTitle = computed(
  () =>
    (
      ({
        "page-detail": "作品详情",
        "page-settings": "设置",
        "page-eh-download": "作品下载",
        "page-unarchived": "未建档",
        "page-archive": "建档助手",
        "page-eh-library": "本地书库",
      }) as Record<string, string>
    )[navigation.activePage] || "首页",
);
const unarchivedCount = computed(() =>
  Math.max(archive.folders.length, settings.unarchivedCount),
);
const shellSearch = computed({
  get: () => (isEh.value ? ehLibrary.search : library.search),
  set: (value: string) => {
    if (isEh.value) {
      ehLibrary.search = value;
      ehLibrary.currentPage = 1;
    } else {
      library.search = value;
      library.currentPage = 1;
    }
  },
});
const showShellClear = computed(() =>
  isEh.value ? ehLibrary.showClearButton : library.showClearButton,
);

function openFilter(key: FilterKey, event: MouseEvent): void {
  event.stopPropagation();
  collapseSearch();
  const button = event.currentTarget as HTMLElement;
  const rect = button.getBoundingClientRect();
  const width = Math.min(key === 'year' ? 410 : key === 'studio' ? 180 : 480, window.innerWidth - 20);
  const half = width / 2;
  const shellInset = 64 + 8;
  const left = Math.max(shellInset + half, Math.min(window.innerWidth - 8 - half, rect.left + rect.width / 2));
  const position: DropdownPosition = { top: rect.bottom + 2, left, width };
  library.toggleDropdown(key, position);
}

function clearSearch(): void {
  if (isEh.value) ehLibrary.clearSearchAndFilters();
  else library.clearSearchAndFilters();
  void nextTick(() => searchElement.value?.focus());
}

function openEhFilter(key: EhFilterKey, event: MouseEvent): void {
  event.stopPropagation();
  collapseSearch();
  library.closeDropdown();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const width = key === "tag" ? 390 : 310;
  const left = Math.max(
    width / 2 + 8,
    Math.min(window.innerWidth - width / 2 - 8, rect.left + rect.width / 2),
  );
  ehDropdownPosition.value = { top: rect.bottom + 8, left, width };
  ehLibrary.toggleDropdown(key);
}

function expandSearch(): void {
  if (searchExpanded.value) return;
  searchExpanded.value = true;
  library.closeDropdown();
  ehLibrary.closeDropdown();
}

function collapseSearch(): void {
  if (!searchExpanded.value) return;
  searchExpanded.value = false;
  if (document.activeElement === searchElement.value)
    searchElement.value?.blur();
}

function goHome(): void {
  library.closeDropdown();
  navigation.showPage("page-home");
}

function goBack(): void {
  if (navigation.activePage === "page-eh-download")
    navigation.showPage("page-settings");
  else if (navigation.activePage === "page-archive")
    void archive.openUnarchivedPage();
  else if (
    navigation.activePage === "page-detail" &&
    navigation.detailSource === "eh"
  )
    navigation.showPage("page-eh-library");
  else goHome();
}

function toggleTheme(event: MouseEvent): void {
  ui.toggleTheme({ x: event.clientX, y: event.clientY });
}

async function syncMaximized(): Promise<void> {
  if (appWindow)
    maximized.value = await appWindow.isMaximized().catch(() => false);
}

async function minimizeWindow(): Promise<void> {
  await appWindow?.minimize();
}

async function toggleMaximize(): Promise<void> {
  await appWindow?.toggleMaximize();
  await syncMaximized();
}

async function closeWindow(): Promise<void> {
  await appWindow?.close();
}

function handleDocumentClick(): void {
  library.closeDropdown();
  ehLibrary.closeDropdown();
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (
    searchExpanded.value &&
    !searchContainer.value?.contains(event.target as Node)
  )
    collapseSearch();
}

watch(
  () => navigation.activePage,
  (page) => {
    if (page !== "page-home") collapseSearch();
  },
);

onMounted(async () => {
  ui.initialize();
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);
  appWindow = currentTauriWindow();
  await syncMaximized();
  if (appWindow)
    stopResize = await appWindow
      .onResized(() => {
        void syncMaximized();
      })
      .catch(() => null);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleDocumentClick);
  document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
  stopResize?.();
});
</script>

<template>
  <aside v-if="!isImmersive" class="app-sidebar">
    <div class="sidebar-primary">
      <ShellBackButton :disabled="isHome" @click="goBack" />
      <button
        class="sidebar-item"
        :class="{ active: isHome }"
        aria-label="首页"
        @click="goHome"
      >
        <span class="fluent-icon sidebar-icon">&#xE80F;</span
        ><span class="sidebar-label">首页</span>
      </button>
      <button
        class="sidebar-item"
        :class="{ active: navigation.activePage === 'page-eh-library' }"
        aria-label="本地书库"
        @click="ehLibrary.openPage"
      >
        <span class="fluent-icon sidebar-icon">&#xE82D;</span
        ><span class="sidebar-label">Eh</span>
      </button>
    </div>
    <div class="sidebar-secondary">
      <button
        class="sidebar-item"
        :class="{
          active:
            navigation.activePage === 'page-unarchived' ||
            navigation.activePage === 'page-archive',
        }"
        aria-label="未建档"
        @click="archive.openUnarchivedPage"
      >
        <span class="fluent-icon sidebar-icon">&#xE8B7;</span
        ><span class="sidebar-label">未建档</span
        ><b v-if="unarchivedCount" class="sidebar-badge">{{
          unarchivedCount > 99 ? "99+" : unarchivedCount
        }}</b>
      </button>
      <button
        class="sidebar-item"
        :aria-label="ui.theme === 'light' ? '切换到深色模式' : '切换到浅色模式'"
        @click="toggleTheme"
      >
        <span class="fluent-icon sidebar-icon">{{
          ui.theme === "light" ? "\uE708" : "\uE706"
        }}</span
        ><span class="sidebar-label">{{
          ui.theme === "light" ? "夜间" : "白天"
        }}</span>
      </button>
      <button
        class="sidebar-item"
        :class="{ active: navigation.activePage === 'page-settings' || navigation.activePage === 'page-eh-download' }"
        aria-label="设置"
        @click="settings.openSettingsPage"
      >
        <span class="fluent-icon sidebar-icon">&#xE713;</span
        ><span class="sidebar-label">设置</span>
      </button>
    </div>
  </aside>

  <header
    v-if="!isImmersive"
    class="app-titlebar"
    :class="{ 'search-active': isBrowsePage && searchExpanded }"
  >
    <div
      class="titlebar-drag-region"
      data-tauri-drag-region
      @pointerdown="library.closeDropdown"
      @dblclick="toggleMaximize"
    ></div>
    <div class="titlebar-navigation" id="filterRow">
      <template v-if="isHome">
        <button
          class="top-filter-tab"
          :class="{ active: library.isFilterActive('year') }"
          @click="openFilter('year', $event)"
        >
          年份<span class="top-filter-arrow">⌄</span>
        </button>
        <button
          class="top-filter-tab"
          :class="{ active: library.isFilterActive('studio') }"
          @click="openFilter('studio', $event)"
        >
          制作商<span class="top-filter-arrow">⌄</span>
        </button>
        <button
          class="top-filter-tab"
          :class="{ active: library.isFilterActive('story') }"
          @click="openFilter('story', $event)"
        >
          剧情<span class="top-filter-arrow">⌄</span>
        </button>
        <button
          class="top-filter-tab"
          :class="{ active: library.isFilterActive('attr') }"
          @click="openFilter('attr', $event)"
        >
          属性<span class="top-filter-arrow">⌄</span>
        </button>
        <button
          class="top-filter-tab"
          :class="{ active: library.isFilterActive('scene') }"
          @click="openFilter('scene', $event)"
        >
          场景<span class="top-filter-arrow">⌄</span>
        </button>
        <button
          class="top-sort-btn"
          id="sortTimeBtn"
          :class="{ active: library.currentSort.startsWith('time') }"
          title="切换时间顺序"
          @click="library.toggleTimeSort"
        >
          时间<span class="fluent-icon">{{
            library.currentSort === "time-desc" ? "\uE74A" : "\uE74B"
          }}</span>
        </button>
        <button
          class="top-sort-btn"
          id="sortNameBtn"
          :class="{ active: library.currentSort.startsWith('name') }"
          title="切换名称顺序"
          @click="library.toggleNameSort"
        >
          名称<span class="fluent-icon">{{
            library.currentSort === "name-desc" ? "\uE74A" : "\uE74B"
          }}</span>
        </button>
      </template>
      <template v-else-if="isEh">
        <button
          v-for="(label, key) in ehFilterLabels"
          :key="key"
          class="top-filter-tab"
          :class="{ active: ehLibrary.isFilterActive(key) }"
          @click="openEhFilter(key, $event)"
        >
          {{ label }}<span class="top-filter-arrow">⌄</span>
        </button>
        <button
          class="top-sort-btn"
          :class="{ active: ehLibrary.currentSort.startsWith('time') }"
          @click="ehLibrary.toggleTimeSort"
        >
          时间<span class="fluent-icon">{{
            ehLibrary.currentSort === "time-desc" ? "\uE74A" : "\uE74B"
          }}</span>
        </button>
        <button
          class="top-sort-btn"
          :class="{ active: ehLibrary.currentSort.startsWith('name') }"
          @click="ehLibrary.toggleNameSort"
        >
          名称<span class="fluent-icon">{{
            ehLibrary.currentSort === "name-desc" ? "\uE74A" : "\uE74B"
          }}</span>
        </button>
        <button
          class="top-sort-btn"
          :class="{ active: ehLibrary.currentSort.startsWith('added') }"
          title="切换入库顺序"
          @click="ehLibrary.toggleAddedSort"
        >
          入库<span class="fluent-icon">{{
            ehLibrary.currentSort === "added-desc" ? "\uE74A" : "\uE74B"
          }}</span>
        </button>
      </template>
      <template v-else>
        <span class="titlebar-page-name">{{ pageTitle }}</span>
      </template>
    </div>

    <span v-if="isBrowsePage" class="titlebar-result-count" id="resultCount"
      >{{
        isEh ? ehLibrary.filteredGalleries.length : library.filteredWorks.length
      }}
      部</span
    >
    <button
      v-if="isBrowsePage && searchExpanded"
      class="titlebar-search-dismiss"
      type="button"
      tabindex="-1"
      aria-hidden="true"
      @pointerdown.stop.prevent="collapseSearch"
    ></button>
    <div
      v-if="isBrowsePage"
      ref="searchContainer"
      class="titlebar-search"
      @pointerdown.stop
    >
      <input
        id="searchInput"
        ref="searchElement"
        v-model="shellSearch"
        type="text"
        :placeholder="
          isEh
            ? '搜索标题、画师、社团、Tag'
            : '搜索标题、别名、简介、制作商、Tag'
        "
        autocomplete="off"
        spellcheck="false"
        @focus="expandSearch"
        @keydown.esc="collapseSearch"
      />
      <button
        v-if="showShellClear"
        class="titlebar-search-clear"
        id="searchClear"
        @click="clearSearch"
      >
        清除
      </button>
      <button
        v-if="isHome"
        class="titlebar-favorite fluent-icon"
        :class="{ active: library.favoriteCharacterMode }"
        :disabled="!library.favoriteCharacters.length"
        :title="
          library.favoriteCharacters.length
            ? '只看收藏角色作品'
            : '尚未收藏角色'
        "
        @click="library.toggleFavoriteCharacterMode"
      >
        {{ library.favoriteCharacterMode ? "\uE735" : "\uE734" }}
      </button>
      <span class="titlebar-search-icon fluent-icon">&#xE721;</span>
    </div>
    <WindowControls
      :maximized="maximized"
      @minimize="minimizeWindow"
      @toggle-maximize="toggleMaximize"
      @close="closeWindow"
    />
  </header>

  <div
    v-else-if="isPlayer"
    class="immersive-window-chrome"
    data-tauri-drag-region
    @dblclick.self="toggleMaximize"
  >
    <WindowControls
      :maximized="maximized"
      @minimize="minimizeWindow"
      @toggle-maximize="toggleMaximize"
      @close="closeWindow"
    />
  </div>

  <ShellFilterDropdowns :eh-dropdown-position="ehDropdownPosition" />
</template>
