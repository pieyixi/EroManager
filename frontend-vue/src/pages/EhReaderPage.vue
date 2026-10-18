<script setup lang="ts">
import { registerReaderPrivacyExit } from "../features/accounts/nativePrivacy";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useEhReaderStore } from "../stores/ehReader";
import { useNavigationStore } from "../stores/navigation";
import { currentTauriWindow, type TauriWindowHandle } from "../api/tauri";
import { useReaderPresentation } from "../features/reader/useReaderPresentation";
import { usePreferencesStore } from '../stores/preferences';
import { requestClose } from '../features/shell/closeController';

const reader = useEhReaderStore();
const navigation = useNavigationStore();
const preferences = usePreferencesStore();
watch(() => reader.direction, direction => {
  if (navigation.activePage === 'page-eh-reader' && !reader.loading && preferences.loaded && preferences.values.reader_direction !== direction) preferences.update({ reader_direction: direction });
});
const { shown, pending, bindImage } = useReaderPresentation();
const maximized = ref(false);
const fullscreen = ref(false);
const fullscreenBusy = ref(false);
const windowError = ref("");
const readerElement = ref<HTMLElement | null>(null);
const readerCanvas = ref<HTMLElement | null>(null);
let stopResize: (() => void) | undefined;
let restoreMaximizedAfterFullscreen = false;
let wheelDelta = 0;
let lastWheelAt = 0;
let wheelLockedUntil = 0;
const frames = computed(() => [shown.value, pending.value].filter(frame => !!frame));
const displayedPageNumber = computed(() => shown.value
  ? Math.min(...shown.value.pages.map(page => page.index)) + 1
  : reader.currentPageNumber);
const displayedSpreadIndex = computed(() => shown.value
  ? Math.max(0, reader.spreads.findIndex(spread => spread.pages.some(page => page.index === displayedPageNumber.value - 1)))
  : reader.spreadIndex);

function handleKeydown(event: KeyboardEvent): void {
  if (navigation.activePage !== "page-eh-reader") return;
  if (event.key === "ArrowLeft") reader.turnLeft();
  else if (event.key === "ArrowRight") reader.turnRight();
  else if (event.key === "ArrowUp") reader.zoom = Math.min(160, reader.zoom + 10);
  else if (event.key === "ArrowDown") reader.zoom = Math.max(50, reader.zoom - 10);
  else if (event.key === "Escape") {
    if (event.repeat || fullscreenBusy.value) {
      event.preventDefault();
      return;
    }
    if (fullscreen.value) void setReaderFullscreen(false);
    else reader.toolsVisible ? reader.toggleTools() : reader.close();
  }
  else return;
  event.preventDefault();
}

async function startReaderDragging(event: MouseEvent): Promise<void> {
  if (event.button !== 0) return;
  const windowHandle = currentTauriWindow();
  if (!windowHandle || fullscreen.value || await windowHandle.isMaximized()) return;
  await windowHandle.startDragging();
}

async function syncMaximized(): Promise<void> {
  const windowHandle = currentTauriWindow();
  maximized.value = await windowHandle?.isMaximized().catch(() => false) || false;
  fullscreen.value = windowHandle
    ? await windowHandle.isFullscreen().catch(() => false)
    : document.fullscreenElement === readerElement.value;
}

async function setNativeFullscreen(windowHandle: TauriWindowHandle, enabled: boolean): Promise<void> {
  if (enabled) {
    const wasMaximized = await windowHandle.isMaximized();
    // Transparent borderless Windows windows must leave maximized mode first,
    // otherwise the native frame expands but WebView2 stays in the work area.
    if (wasMaximized) await windowHandle.unmaximize();
    try {
      await windowHandle.setFullscreen(true);
      restoreMaximizedAfterFullscreen = wasMaximized;
    } catch (error) {
      if (wasMaximized) await windowHandle.maximize();
      throw error;
    }
  } else {
    await windowHandle.setFullscreen(false);
    if (restoreMaximizedAfterFullscreen) await windowHandle.maximize();
    restoreMaximizedAfterFullscreen = false;
  }
}

async function setReaderFullscreen(enabled: boolean): Promise<void> {
  if (fullscreenBusy.value) return;
  fullscreenBusy.value = true;
  windowError.value = "";
  try {
    const windowHandle = currentTauriWindow();
    if (windowHandle) await setNativeFullscreen(windowHandle, enabled);
    else if (enabled) await readerElement.value?.requestFullscreen();
    else if (document.fullscreenElement) await document.exitFullscreen();
    await syncMaximized();
    if (enabled && navigation.activePage !== "page-eh-reader") {
      if (windowHandle) await setNativeFullscreen(windowHandle, false);
      else if (document.fullscreenElement) await document.exitFullscreen();
      await syncMaximized();
    }
  } catch {
    windowError.value = enabled ? "无法进入全屏，请重试" : "无法退出全屏，请重试";
  } finally {
    fullscreenBusy.value = false;
  }
}

function returnFromReader(): void {
  if (fullscreenBusy.value) return;
  if (fullscreen.value) void setReaderFullscreen(false);
  else reader.close();
}

async function minimizeWindow(): Promise<void> {
  await currentTauriWindow()?.minimize();
}

async function toggleMaximize(): Promise<void> {
  if (fullscreen.value) {
    await setReaderFullscreen(false);
    return;
  }
  await currentTauriWindow()?.toggleMaximize();
  await syncMaximized();
}

async function closeWindow(): Promise<void> {
  await requestClose();
}

function scrollZoomedPage(event: WheelEvent): void {
  const target = event.target as HTMLElement;
  if (target.closest(".reader-tools, .reader-side-tools, .reader-settings")) return;

  if (reader.zoom <= 100) {
    if (!preferences.values.reader_wheel) return;
    if (!event.deltaY) return;
    event.preventDefault();
    const now = performance.now();
    if (now < wheelLockedUntil) return;
    if (now - lastWheelAt > 180) wheelDelta = 0;
    lastWheelAt = now;
    wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 240 : 1);
    if (Math.abs(wheelDelta) < 45) return;
    if (wheelDelta > 0) reader.next();
    else reader.previous();
    wheelDelta = 0;
    wheelLockedUntil = now + 260;
    return;
  }

  if (!readerCanvas.value) return;
  event.preventDefault();
  readerCanvas.value.scrollTop += event.deltaY;
}

watch(
  () => navigation.activePage,
  (page, previousPage) => {
    if (previousPage === "page-eh-reader" && page !== previousPage && fullscreen.value)
      void setReaderFullscreen(false);
    if (page === "page-eh-reader") void syncMaximized();
  },
);

watch(
  () => shown.value?.id,
  async () => {
    await nextTick();
    if (readerCanvas.value) readerCanvas.value.scrollTop = 0;
  },
);

watch(
  () => reader.zoom,
  (zoom) => {
    if (zoom <= 100 && readerCanvas.value) readerCanvas.value.scrollTop = 0;
  },
);

onMounted(async () => {
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("fullscreenchange", syncMaximized);
  await syncMaximized();
  stopResize = await currentTauriWindow()?.onResized(syncMaximized);
});
onBeforeUnmount(() => {
  registerReaderPrivacyExit();
  document.removeEventListener("keydown", handleKeydown);
  document.removeEventListener("fullscreenchange", syncMaximized);
  if (fullscreen.value) void setReaderFullscreen(false);
  stopResize?.();
});
</script>

<template>
  <div
    id="page-eh-reader"
    class="page"
    :class="{ active: navigation.activePage === 'page-eh-reader' }"
  >
    <div ref="readerElement" class="reader" @contextmenu.prevent="reader.toggleTools" @wheel="scrollZoomedPage">
      <div class="reader-drag-strip" @mousedown="startReaderDragging"></div>
      <div class="reader-exit-hotspot">
        <button class="reader-exit" :aria-label="fullscreen ? '退出全屏' : '退出阅读'" @click.stop="returnFromReader">
          <span>‹</span>{{ fullscreen ? '退出全屏' : '退出阅读' }}
        </button>
      </div>
      <div class="reader-window-hotspot">
        <div class="reader-window-controls">
          <button class="window-control minimize" aria-label="最小化" @click.stop="minimizeWindow"></button>
          <button class="window-control maximize" :class="{ restore: maximized || fullscreen }" :aria-label="fullscreen ? '退出全屏' : maximized ? '还原' : '最大化'" @click.stop="toggleMaximize"></button>
          <button class="window-control close" aria-label="关闭" @click.stop="closeWindow"></button>
        </div>
      </div>
      <header class="reader-top" :class="{ visible: reader.toolsVisible }">
        <button class="reader-back" :aria-label="fullscreen ? '退出全屏' : '退出阅读'" @click.stop="returnFromReader">‹</button
        ><strong>{{ reader.gallery?.title }}</strong
        ><span>{{ displayedPageNumber }} / {{ reader.pages.length }}</span>
      </header>
      <div v-if="reader.loading && !shown" class="reader-state">正在准备页面...</div>
      <div v-else-if="reader.error && !shown" class="reader-state">
        {{ reader.error }}
      </div>
      <div
        v-else
        ref="readerCanvas"
        class="reader-canvas"
        :class="{ zoomed: reader.zoom > 100 }"
        :style="{ '--zoom': reader.zoom / 100 }"
      >
        <div v-for="frame in frames" :key="frame.id" class="reader-frame" :class="{ preparing: frame !== shown }" :aria-hidden="frame !== shown">
          <div class="reader-pages" :class="{ single: frame.pages.length === 1, merged: frame.merged }">
            <img v-for="page in frame.pages" :key="page.index" :ref="element => bindImage(frame, page.index, element)" :src="page.src" :width="page.width" :height="page.height" :class="{ landscape: page.width > page.height }" />
          </div>
        </div>
      </div>
      <button
        class="reader-turn reader-left"
        :aria-label="reader.direction === 'rtl' ? '下一页' : '上一页'"
        @click.stop="reader.turnLeft"
      >
        <span>‹</span>
      </button>
      <button
        class="reader-turn reader-right"
        :aria-label="reader.direction === 'rtl' ? '上一页' : '下一页'"
        @click.stop="reader.turnRight"
      >
        <span>›</span>
      </button>
      <div
        class="reader-dim"
        :class="{ visible: reader.toolsVisible }"
        @click.stop="reader.toggleTools"
      ></div>
      <div class="reader-page-info" :class="{ visible: reader.toolsVisible }">
        <strong
          >{{ displayedPageNumber
          }}<template v-if="shown?.pages.length === 2"
            >–{{ displayedPageNumber + 1 }}</template
          ></strong
        ><span>/ {{ reader.pages.length }} 页</span>
      </div>
      <div
        class="reader-tools"
        :class="{ visible: reader.toolsVisible }"
        @click.stop
      >
        <div class="reader-zoom">
          <button @click="reader.zoom = Math.max(50, reader.zoom - 10)">
            −</button
          ><span>{{ reader.zoom }}%</span
          ><button @click="reader.zoom = Math.min(160, reader.zoom + 10)">
            ＋
          </button>
        </div>
        <div class="reader-progress">
          <button :aria-label="reader.direction === 'rtl' ? '下一页' : '上一页'" @click="reader.turnLeft">|‹</button
          ><span
            >{{ displayedPageNumber }} / {{ reader.pages.length }}</span
          ><input
            :value="displayedSpreadIndex"
            :dir="reader.direction"
            aria-label="阅读进度"
            type="range"
            min="0"
            :max="Math.max(0, reader.spreads.length - 1)"
            step="1"
            @input="reader.goToSpread(Number(($event.target as HTMLInputElement).value))"
          /><button :aria-label="reader.direction === 'rtl' ? '上一页' : '下一页'" @click="reader.turnRight">›|</button>
        </div>
      </div>
      <div
        class="reader-side-tools"
        :class="{ visible: reader.toolsVisible }"
        @click.stop
      >
        <button :class="{ active: fullscreen }" :disabled="fullscreenBusy" @click="setReaderFullscreen(!fullscreen)">
          {{ fullscreen ? '退出全屏' : '全屏阅读' }}
        </button>
        <p v-if="windowError" role="status">{{ windowError }}</p>
        <button
          v-if="reader.currentSpread?.pages.length === 2"
          :class="{ active: reader.currentPairMerged }"
          @click="reader.toggleCurrentPairMerge"
        >
          {{ reader.currentPairMerged ? "取消合并" : "合并当前两页" }}</button
        ><button @click="reader.togglePairing">更改跨页匹配</button
        ><button @click="reader.settingsVisible = !reader.settingsVisible">
          <span class="fluent-icon">&#xE713;</span> 阅读设置
        </button>
      </div>
      <section
        v-if="reader.settingsVisible"
        class="reader-settings"
        @click.stop
      >
        <h2>阅读设置</h2>
        <div class="setting-row">
          <span>页面模式</span>
          <div>
            <button
              :class="{ active: reader.pageMode === 'double' }"
              @click="reader.setPageMode('double')"
            >
              双页</button
            ><button
              :class="{ active: reader.pageMode === 'single' }"
              @click="reader.setPageMode('single')"
            >
              单页
            </button>
          </div>
        </div>
        <div class="setting-row">
          <span>翻页方向</span>
          <div>
            <button
              :class="{ active: reader.direction === 'rtl' }"
              @click="reader.direction = 'rtl'"
            >
              日漫模式</button
            ><button
              :class="{ active: reader.direction === 'ltr' }"
              @click="reader.direction = 'ltr'"
            >
              普通模式
            </button>
          </div>
        </div>
        <div class="setting-row">
          <span>图片缩放</span>
          <div>
            <button
              :class="{ active: reader.zoom === 100 }"
              @click="reader.zoom = 100"
            >
              适应屏幕
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped src="../assets/styles/reader.css"></style>
