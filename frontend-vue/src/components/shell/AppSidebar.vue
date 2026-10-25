<script setup lang="ts">
import { returnCoverDetail, detailReturnOrigin, detailOriginPage } from '../../features/shell/detailTransition';
import { useHomeHandStore } from '../../stores/homeHand';
import { useHomeStore } from '../../stores/home';
import { computed } from 'vue';
import { useNavigationStore } from '../../stores/navigation';
import { useLibraryStore } from '../../stores/library';
import { useEhLibraryStore } from '../../stores/ehLibrary';
import { useAvLibraryStore } from '../../stores/avLibrary';
import { useArchiveStore } from '../../stores/archive';
import { useLibraryConsoleStore } from '../../stores/libraryConsole';
import { useUiStore } from '../../stores/ui';
import ShellBackButton from '../shared/ShellBackButton.vue';

const navigation = useNavigationStore();
const home = useHomeStore();
const hand = useHomeHandStore();
const library = useLibraryStore();
const ehLibrary = useEhLibraryStore();
const avLibrary = useAvLibraryStore();
const archive = useArchiveStore();
const settings = useLibraryConsoleStore();
const ui = useUiStore();
const isHome = computed(() => navigation.activePage === 'page-home');
const isMediaLibrary = computed(() => navigation.activePage === 'page-media-library');
const unarchivedCount = computed(() =>
  Math.max(archive.folders.length, settings.unarchivedCount),
);
function goHome(): void {
  library.closeDropdown();
  ehLibrary.closeDropdown();
  if (!returnToHome()) navigation.showPage("page-home");
}

function openMediaLibrary(): void {
  navigation.showPage("page-media-library");
}

function returnToHome(): boolean {
  if (navigation.activePage !== 'page-detail' || navigation.detailReturnPage !== 'page-home') return false;
  const source = navigation.detailSource === 'eh' ? 'book' : 'media';
  const id = source === 'book' ? ehLibrary.currentGallery?.gid : library.currentDetailWorkId;
  const remembered = detailReturnOrigin.value;
  const origin = remembered?.source === source && remembered.id === id && detailOriginPage(remembered.origin) === 'page-home' ? remembered.origin : source;
  if (origin !== 'media' && origin !== 'book' && origin !== 'hand') return false;
  if (origin === 'hand' ? hand.current?.source !== source || hand.current.id !== id : home[source].current?.id !== id) return false;
  void returnCoverDetail(origin, () => navigation.showPage('page-home'));
  return true;
}
function goBack(): void {
  if (returnToHome()) return;
  if (navigation.activePage === 'page-detail') {
    const remembered = detailReturnOrigin.value;
    const source = navigation.detailSource === 'av' ? 'av' : navigation.detailSource === 'eh' ? 'book' : 'media';
    const id = source === 'av' ? avLibrary.currentWork?.code : source === 'book' ? ehLibrary.currentGallery?.gid : library.currentDetailWorkId;
    if (remembered?.source === source && remembered.id === id && detailOriginPage(remembered.origin) === navigation.backPage) {
      const destination = navigation.backPage;
      void returnCoverDetail(remembered.origin, () => navigation.showPage(destination));
      return;
    }
  }
  if (navigation.activePage === "page-archive")
    void archive.openUnarchivedPage();
  else navigation.goBack();
}

function toggleTheme(event: MouseEvent): void {
  ui.toggleTheme({ x: event.clientX, y: event.clientY });
}

</script>

<template>
  <aside class="app-sidebar">
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
        :class="{ active: isMediaLibrary }"
        aria-label="里番"
        @click="openMediaLibrary"
      >
        <svg class="sidebar-icon" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 3 4 3 4-3"/><rect x="3" y="7" width="18" height="13" rx="3"/><path d="M8 20v1m8-1v1"/></svg>
        <span class="sidebar-label">里番</span>
      </button>
      <button
        class="sidebar-item"
        :class="{ active: navigation.activePage === 'page-eh-library' }"
        aria-label="本子"
        @click="ehLibrary.openPage"
      >
        <span class="fluent-icon sidebar-icon">&#xE82D;</span
        ><span class="sidebar-label">本子</span>
      </button>
      <button
        class="sidebar-item"
        :class="{ active: navigation.activePage === 'page-av-library' }"
        aria-label="AV"
        @click="navigation.showPage('page-av-library')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="sidebar-icon" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="2.5" y="5.5" width="13.5" height="13" rx="3" />
          <path d="m16 10 4.3-2.45a.8.8 0 0 1 1.2.7v7.5a.8.8 0 0 1-1.2.7L16 14" />
        </svg>
        <span class="sidebar-label">AV</span>
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
        :class="{ active: navigation.activePage === 'page-eh-download' }"
        aria-label="下载"
        @click="navigation.showPage('page-eh-download')"
      >
        <svg
          class="sidebar-icon"
          width="24" height="24" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="1.5"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        >
          <path d="M10.5 3.25h3a.75.75 0 0 1 .75.75v5.25H17a.65.65 0 0 1 .47 1.1l-4.65 4.82a1.15 1.15 0 0 1-1.64 0L6.53 10.35A.65.65 0 0 1 7 9.25h2.75V4a.75.75 0 0 1 .75-.75Z" />
          <path d="M3.5 15.75v2.5a2.5 2.5 0 0 0 2.5 2.5h12a2.5 2.5 0 0 0 2.5-2.5v-2.5" />
        </svg>
        <span class="sidebar-label">下载</span>
      </button>
      <button
        class="sidebar-item"
        :class="{ active: navigation.activePage === 'page-settings' }"
        aria-label="设置"
        @click="settings.openSettingsPage"
      >
        <span class="fluent-icon sidebar-icon">&#xE713;</span
        ><span class="sidebar-label">设置</span>
      </button>
    </div>
  </aside>
</template>
