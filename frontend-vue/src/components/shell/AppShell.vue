<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useNavigationStore } from '../../stores/navigation';
import { useUiStore } from '../../stores/ui';
import { useShellBrowseControls } from '../../features/shell/useShellBrowseControls';
import { useShellWindowControls } from '../../features/shell/useShellWindowControls';
import AppSidebar from './AppSidebar.vue';
import ShellBrowseToolbar from './ShellBrowseToolbar.vue';
import ShellFilterDropdowns from './ShellFilterDropdowns.vue';
import WindowControls from '../shared/WindowControls.vue';

const navigation = useNavigationStore();
const ui = useUiStore();
onMounted(() => ui.initialize());
// 控制器保持壳层生命周期，进入播放器时也会清理搜索、下拉框和上下文菜单。
const browse = useShellBrowseControls();
const { isBrowsePage, searchExpanded, ehDropdownPosition, closeMediaDropdown } = browse;
const { maximized, minimizeWindow, toggleMaximize, closeWindow } = useShellWindowControls();
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
        "page-media-library": "里番库",
        "page-eh-library": "本子库",
      }) as Record<string, string>
    )[navigation.activePage] || "首页",
);

</script>

<template>
  <AppSidebar v-if="!isImmersive" />

  <header
    v-if="!isImmersive"
    class="app-titlebar"
    :class="{ 'search-active': isBrowsePage && searchExpanded }"
  >
    <div
      class="titlebar-drag-region"
      data-tauri-drag-region
      @pointerdown="closeMediaDropdown"
      @dblclick="toggleMaximize"
    ></div>
    <ShellBrowseToolbar :controls="browse" :page-title="pageTitle" />
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
