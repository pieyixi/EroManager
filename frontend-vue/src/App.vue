<script setup lang="ts">
import { computed, provide, ref, onBeforeUnmount, onMounted } from 'vue';
import './assets/styles.css';
import AppShell from './components/shell/AppShell.vue';
import ArchivePage from './pages/ArchivePage.vue';
import AvLibraryPage from './pages/AvLibraryPage.vue';
import DetailPage from './pages/DetailPage.vue';
import EhLibraryPage from './pages/EhLibraryPage.vue';
import EhDownloadPage from './pages/EhDownloadPage.vue';
import EhReaderPage from './pages/EhReaderPage.vue';
import GlobalOverlays from './components/shell/GlobalOverlays.vue';
import DownloadNotices from './components/downloads/DownloadNotices.vue';
import CloseApplicationDialog from './components/shell/CloseApplicationDialog.vue';
import DetailCoverFlight from './components/shell/DetailCoverFlight.vue';
import HomePage from './pages/HomePage.vue';
import MediaLibraryPage from './pages/MediaLibraryPage.vue';
import PlayerPage from './pages/PlayerPage.vue';
import SettingsPage from './pages/SettingsPage.vue';
import UnarchivedPage from './pages/UnarchivedPage.vue';
import { startApplicationRuntime } from './runtime/startApplication';
import { useNavigationStore } from './stores/navigation';
import AccountGate from './components/accounts/AccountGate.vue';
import { useAccountsStore } from './stores/accounts';
import StartupScreen from './components/shell/StartupScreen.vue';
import { useStartupScreen } from './features/shell/useStartupScreen';

let stopApplicationRuntime: (() => void) | undefined;
const navigation = useNavigationStore();
const accounts = useAccountsStore();
const accountCurtain = ref(false);
provide('suspendDialogs', computed(() => accounts.locked || accounts.selecting));
const startup = useStartupScreen();
const { visible: starting, drawsHeld } = startup;

onMounted(() => {
  stopApplicationRuntime = startApplicationRuntime(startup);
});

onBeforeUnmount(() => {
  stopApplicationRuntime?.();
});
</script>

<template>
  <div class="window" :inert="starting || drawsHeld || accountCurtain || accounts.locked || accounts.selecting" :class="{ 'startup-preparing': starting, 'startup-draw-held': drawsHeld || accountCurtain, 'player-shell-layout': navigation.activePage === 'page-player', 'reader-shell-layout': navigation.activePage === 'page-eh-reader' }">
    <AppShell />
    <main class="app-main" :class="{ 'player-content': navigation.activePage === 'page-player', 'reader-content': navigation.activePage === 'page-eh-reader' }">
      <HomePage />
      <MediaLibraryPage />
      <EhLibraryPage />
      <AvLibraryPage />
      <EhDownloadPage />
      <EhReaderPage />
      <DetailPage />
      <PlayerPage />
      <SettingsPage />
      <UnarchivedPage />
      <ArchivePage />
    </main>
  </div>
  <DetailCoverFlight />
  <GlobalOverlays />
  <DownloadNotices />
  <CloseApplicationDialog />
  <AccountGate @visibility="accountCurtain = $event" />
  <StartupScreen :visible="starting" @ready="startup.reveal" />
</template>

<style>
#app {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
/* 隐藏库页也按真实首屏尺寸排版，避免开屏只准备默认页大小。 */
.startup-preparing .app-main { position: relative; }
.startup-preparing #page-media-library,
.startup-preparing #page-eh-library {
  display: flex;
  position: absolute;
  inset: 0;
  visibility: hidden;
  pointer-events: none;
}
.startup-draw-held #page-home .home-draw-flipper { animation-play-state: paused; }
</style>
