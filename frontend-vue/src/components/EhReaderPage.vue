<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useEhReaderStore } from "../stores/ehReader";
import { useNavigationStore } from "../stores/navigation";
import { currentTauriWindow } from "../api/tauri";

const reader = useEhReaderStore();
const navigation = useNavigationStore();
const maximized = ref(false);
const readerCanvas = ref<HTMLElement | null>(null);
let stopResize: (() => void) | undefined;
const visiblePages = computed(() => {
  const pages = reader.currentSpread?.pages || [];
  return reader.direction === "rtl" ? [...pages].reverse() : pages;
});

function handleKeydown(event: KeyboardEvent): void {
  if (navigation.activePage !== "page-eh-reader") return;
  if (event.key === "ArrowLeft") reader.turnLeft();
  else if (event.key === "ArrowRight") reader.turnRight();
  else if (event.key === "ArrowUp") reader.zoom = Math.min(160, reader.zoom + 10);
  else if (event.key === "ArrowDown") reader.zoom = Math.max(50, reader.zoom - 10);
  else if (event.key === "Escape")
    reader.toolsVisible ? reader.toggleTools() : reader.close();
  else return;
  event.preventDefault();
}

async function startReaderDragging(event: MouseEvent): Promise<void> {
  if (event.button !== 0) return;
  const windowHandle = currentTauriWindow();
  if (!windowHandle || await windowHandle.isMaximized()) return;
  await windowHandle.startDragging();
}

async function syncMaximized(): Promise<void> {
  maximized.value = await currentTauriWindow()?.isMaximized().catch(() => false) || false;
}

async function minimizeWindow(): Promise<void> {
  await currentTauriWindow()?.minimize();
}

async function toggleMaximize(): Promise<void> {
  await currentTauriWindow()?.toggleMaximize();
  await syncMaximized();
}

async function closeWindow(): Promise<void> {
  await currentTauriWindow()?.close();
}

function scrollZoomedPage(event: WheelEvent): void {
  if (reader.zoom <= 100 || !readerCanvas.value) return;
  const target = event.target as HTMLElement;
  if (target.closest(".reader-tools, .reader-side-tools, .reader-settings")) return;
  event.preventDefault();
  readerCanvas.value.scrollTop += event.deltaY;
}

function recordPageDimensions(pageIndex: number, event: Event): void {
  const image = event.currentTarget as HTMLImageElement;
  reader.recordPageDimensions(pageIndex, image.naturalWidth, image.naturalHeight);
}

watch(
  () => reader.spreadIndex,
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
  await syncMaximized();
  stopResize = await currentTauriWindow()?.onResized(syncMaximized);
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", handleKeydown);
  stopResize?.();
});
</script>

<template>
  <div
    id="page-eh-reader"
    class="page"
    :class="{ active: navigation.activePage === 'page-eh-reader' }"
  >
    <div class="reader" @contextmenu.prevent="reader.toggleTools" @wheel="scrollZoomedPage">
      <div class="reader-drag-strip" @mousedown="startReaderDragging"></div>
      <div class="reader-exit-hotspot">
        <button class="reader-exit" aria-label="退出阅读" @click.stop="reader.close">
          <span>‹</span>退出阅读
        </button>
      </div>
      <div class="reader-window-hotspot">
        <div class="reader-window-controls">
          <button class="window-control minimize" aria-label="最小化" @click.stop="minimizeWindow"></button>
          <button class="window-control maximize" :class="{ restore: maximized }" :aria-label="maximized ? '还原' : '最大化'" @click.stop="toggleMaximize"></button>
          <button class="window-control close" aria-label="关闭" @click.stop="closeWindow"></button>
        </div>
      </div>
      <header class="reader-top" :class="{ visible: reader.toolsVisible }">
        <button class="reader-back" @click.stop="reader.close">‹</button
        ><strong>{{ reader.gallery?.title }}</strong
        ><span>{{ reader.currentPageNumber }} / {{ reader.pages.length }}</span>
      </header>
      <div v-if="reader.loading" class="reader-state">正在准备页面...</div>
      <div v-else-if="reader.error" class="reader-state">
        {{ reader.error }}
      </div>
      <div
        v-else
        ref="readerCanvas"
        class="reader-canvas"
        :class="{ zoomed: reader.zoom > 100 }"
        :style="{ '--zoom': reader.zoom / 100 }"
      >
        <div
          class="reader-pages"
          :class="{
            single: visiblePages.length === 1,
            merged: reader.currentPairMerged,
          }"
        >
          <img
            v-for="page in visiblePages"
            :key="page.index"
            :src="reader.imageUrl(page.path)"
            :class="{ landscape: page.width > page.height }"
            @load="recordPageDimensions(page.index, $event)"
          />
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
          >{{ reader.currentPageNumber
          }}<template v-if="reader.currentSpread?.pages.length === 2"
            >–{{ reader.currentPageNumber + 1 }}</template
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
          <button @click="reader.previous">|‹</button
          ><span
            >{{ reader.currentPageNumber }} / {{ reader.pages.length }}</span
          ><input
            :value="reader.spreadIndex"
            type="range"
            min="0"
            :max="Math.max(0, reader.spreads.length - 1)"
            step="1"
            @input="reader.goToSpread(Number(($event.target as HTMLInputElement).value))"
          /><button @click="reader.next">›|</button>
        </div>
      </div>
      <div
        class="reader-side-tools"
        :class="{ visible: reader.toolsVisible }"
        @click.stop
      >
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

<style scoped>
#page-eh-reader.active {
  position: fixed;
  z-index: 1000;
  inset: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #171717;
}
.reader {
  position: fixed;
  z-index: 1;
  inset: -1px;
  background: #171717;
  color: #eee;
  overflow: hidden;
  user-select: none;
}
.reader-exit-hotspot {
  position: fixed;
  z-index: 26;
  top: 0;
  left: 0;
  width: 132px;
  height: 82px;
  display: flex;
  justify-content: flex-start;
  align-items: flex-start;
  padding: 14px 16px;
}
.reader-drag-strip {
  position: fixed;
  z-index: 19;
  top: 0;
  left: 132px;
  right: 156px;
  height: 46px;
  cursor: default;
}
.reader-window-hotspot {
  position: fixed;
  z-index: 27;
  top: 0;
  right: 0;
  width: 156px;
  height: 82px;
  padding: 14px 16px 0 0;
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
}
.reader-window-controls {
  display: flex;
  gap: 5px;
  opacity: 0;
  transform: translateY(-8px);
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.reader-window-hotspot:hover .reader-window-controls,
.reader-window-controls:focus-within {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
.reader-window-controls .window-control {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-color: rgba(12, 12, 12, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(14px);
}
.reader-window-controls .window-control:hover {
  background-color: rgba(42, 42, 42, 0.92);
}
.reader-exit {
  height: 36px;
  padding: 0 14px 0 9px;
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 18px;
  background: rgba(12, 12, 12, 0.78);
  color: #eee;
  font: 12px/1 inherit;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(14px);
  opacity: 0;
  transform: translateY(-8px);
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease, background 0.16s ease;
}
.reader-exit-hotspot:hover .reader-exit,
.reader-exit:focus-visible {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
.reader-exit:hover {
  background: rgba(42, 42, 42, 0.92);
}
.reader-exit span {
  font-size: 24px;
  line-height: 1;
  transform: translateY(-1px);
}
.reader-state {
  height: 100%;
  display: grid;
  place-items: center;
  color: #aaa;
}
.reader-canvas {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.reader-canvas.zoomed {
  align-items: start;
  justify-items: center;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.24) transparent;
}
.reader-canvas.zoomed .reader-pages {
  height: auto;
  min-height: 100%;
}
.reader-canvas.zoomed .reader-pages img {
  max-width: none;
  flex-shrink: 0;
}
.reader-pages {
  height: 100%;
  max-width: calc(100vw - 300px);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  transition: gap 0.18s ease;
}
.reader-pages.merged {
  gap: 0;
}
.reader-pages img {
  display: block;
  max-width: calc(50% - 9px);
  height: min(calc(100vh * var(--zoom)), 160vh);
  object-fit: contain;
  background: #252525;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06);
}
.reader-pages.merged img {
  max-width: 50%;
}
.reader-pages.single img,
.reader-pages img.landscape {
  max-width: 100%;
  width: auto;
}
.reader-top {
  position: fixed;
  z-index: 20;
  left: 0;
  right: 0;
  top: 0;
  height: 46px;
  padding: 0 24px;
  display: grid;
  grid-template-columns: 52px 1fr auto;
  align-items: center;
  background: rgba(8, 8, 8, 0.86);
  backdrop-filter: blur(16px);
  opacity: 0;
  transform: translateY(-100%);
  transition: 0.2s;
}
.reader-top.visible {
  opacity: 1;
  transform: none;
}
.reader-top strong {
  text-align: center;
  font-size: 13px;
}
.reader-top span {
  font-size: 11px;
  color: #aaa;
}
.reader-back {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #fff;
  font-size: 30px;
  cursor: pointer;
}
.reader-back:hover {
  background: #303030;
}
.reader-turn {
  position: fixed;
  z-index: 5;
  top: 46px;
  bottom: 0;
  width: 50%;
  border: 0;
  background: transparent;
  color: transparent;
  cursor: pointer;
}
.reader-turn:focus,
.reader-turn:focus-visible {
  outline: none;
}
.reader-left {
  left: 0;
  text-align: left;
}
.reader-right {
  right: 0;
  text-align: right;
}
.reader-turn span {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 72px;
  margin: 0 22px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.42);
  color: #fff;
  font-size: 45px;
  opacity: 0;
  transition: 0.15s;
}
.reader-turn:hover span {
  opacity: 0.7;
}
.reader-dim {
  position: fixed;
  z-index: 8;
  inset: 0;
  background: rgba(0, 0, 0, 0.34);
  opacity: 0;
  pointer-events: none;
  transition: 0.18s;
}
.reader-dim.visible {
  opacity: 1;
  pointer-events: auto;
}
.reader-tools {
  position: fixed;
  z-index: 20;
  left: 50%;
  bottom: 20px;
  display: flex;
  align-items: center;
  gap: 18px;
  opacity: 0;
  transform: translate(-50%, 24px);
  pointer-events: none;
  transition: 0.2s;
}
.reader-tools.visible {
  opacity: 1;
  transform: translate(-50%, 0);
  pointer-events: auto;
}
.reader-zoom,
.reader-progress {
  height: 42px;
  border: 1px solid #3b3b3b;
  border-radius: 22px;
  background: rgba(10, 10, 10, 0.94);
  display: flex;
  align-items: center;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.42);
}
.reader-zoom button,
.reader-progress button {
  width: 42px;
  height: 100%;
  border: 0;
  background: transparent;
  color: #ddd;
  font-size: 18px;
  cursor: pointer;
}
.reader-zoom span {
  width: 55px;
  text-align: center;
  font-size: 11px;
  color: #aaa;
}
.reader-progress {
  width: min(620px, 48vw);
  padding: 0 8px;
}
.reader-progress span {
  width: 70px;
  font-size: 11px;
  color: #aaa;
  text-align: center;
}
.reader-progress input {
  flex: 1;
  accent-color: #2f9cf4;
}
.reader-page-info {
  position: fixed;
  z-index: 20;
  left: 28px;
  bottom: 20px;
  height: 50px;
  padding: 0 15px;
  border: 1px solid #3b3b3b;
  border-radius: 7px;
  background: rgba(10, 10, 10, 0.94);
  display: flex;
  align-items: center;
  gap: 7px;
  opacity: 0;
  transform: translateY(16px);
  transition: 0.2s;
}
.reader-page-info.visible {
  opacity: 1;
  transform: none;
}
.reader-page-info strong {
  font-size: 18px;
}
.reader-page-info span {
  font-size: 10px;
  color: #aaa;
}
.reader-side-tools {
  position: fixed;
  z-index: 20;
  right: 30px;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  opacity: 0;
  transform: translateY(16px);
  pointer-events: none;
  transition: 0.2s;
}
.reader-side-tools.visible {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
.reader-side-tools button {
  height: 38px;
  padding: 0 18px;
  border: 1px solid #3b3b3b;
  border-radius: 20px;
  background: rgba(10, 10, 10, 0.94);
  color: #eee;
  font: 12px/1 inherit;
  cursor: pointer;
}
.reader-side-tools button:hover {
  border-color: #777;
  background: #242424;
}
.reader-side-tools button.active {
  border-color: #209bea;
  color: #55b9ff;
}
.reader-settings {
  position: fixed;
  z-index: 30;
  left: 50%;
  top: 50%;
  width: 450px;
  padding: 20px 24px;
  transform: translate(-50%, -50%);
  border: 1px solid #3d3d3d;
  border-radius: 12px;
  background: rgba(20, 20, 20, 0.97);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.55);
}
.reader-settings h2 {
  font-size: 15px;
  margin-bottom: 12px;
}
.setting-row {
  min-height: 76px;
  border-top: 1px solid #333;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.setting-row > span {
  font-size: 12px;
}
.setting-row > div {
  display: flex;
  gap: 8px;
}
.setting-row button {
  height: 36px;
  min-width: 90px;
  padding: 0 14px;
  border: 1px solid #777;
  border-radius: 20px;
  background: transparent;
  color: #eee;
  cursor: pointer;
}
.setting-row button.active {
  border-color: #209bea;
  color: #55b9ff;
}
@media (max-width: 900px) {
  .reader-pages {
    max-width: 100vw;
  }
  .reader-side-tools {
    right: 16px;
  }
  .reader-progress {
    width: 42vw;
  }
}
</style>
