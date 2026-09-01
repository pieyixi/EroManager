<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import './assets/styles.css';
import AppShell from './components/AppShell.vue';
import ArchivePage from './components/ArchivePage.vue';
import DetailPage from './components/DetailPage.vue';
import EhLibraryPage from './components/EhLibraryPage.vue';
import EhReaderPage from './components/EhReaderPage.vue';
import GlobalOverlays from './components/GlobalOverlays.vue';
import HomePage from './components/HomePage.vue';
import PlayerPage from './components/PlayerPage.vue';
import SettingsPage from './components/SettingsPage.vue';
import UnarchivedPage from './components/UnarchivedPage.vue';
import { startApplicationRuntime } from './runtime/startApplication';
import { useNavigationStore } from './stores/navigation';

let stopApplicationRuntime: (() => void) | undefined;
const navigation = useNavigationStore();

onMounted(() => {
  stopApplicationRuntime = startApplicationRuntime();
});

onBeforeUnmount(() => {
  stopApplicationRuntime?.();
});
</script>

<template>
  <div class="window" :class="{ 'player-shell-layout': navigation.activePage === 'page-player', 'reader-shell-layout': navigation.activePage === 'page-eh-reader' }">
    <AppShell />
    <main class="app-main" :class="{ 'player-content': navigation.activePage === 'page-player', 'reader-content': navigation.activePage === 'page-eh-reader' }">
      <HomePage />
      <EhLibraryPage />
      <EhReaderPage />
      <DetailPage />
      <PlayerPage />
      <SettingsPage />
      <UnarchivedPage />
      <ArchivePage />
    </main>
  </div>
  <GlobalOverlays />
</template>

<style>
#app {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
