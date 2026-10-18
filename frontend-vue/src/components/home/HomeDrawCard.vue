<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { DrawPhase, DrawPreview, DrawSelection } from '../../stores/home';
import { registerDetailCover, coverFlightVisible } from '../../features/shell/detailTransition';
import { useDrawPreviews } from '../../features/home/useDrawPreviews';
import HomeCardBack from './HomeCardBack.vue';

const props = defineProps<{
  label: string;
  kind: 'media' | 'book';
  selection: DrawSelection | null;
  retiring: DrawSelection | null;
  phase: DrawPhase;
  busy: boolean;
  error: string;
  loading: boolean;
  dragging?: boolean;
  active: boolean;
  transitioning: boolean;
  allowActivate: (event: MouseEvent) => boolean;
}>();
const emit = defineEmits<{ draw: [event: MouseEvent]; detail: []; animationEnd: [phase: DrawPhase]; cardPointerDown: [event: PointerEvent]; cardPointerMove: [event: PointerEvent]; cardPointerUp: [event: PointerEvent]; cardPointerCancel: [] }>();
const pressed = ref(false);
const coverFace = ref<HTMLElement | null>(null);
const coverImage = ref<HTMLImageElement | null>(null);
watch([coverFace, coverImage], ([element, image]) => registerDetailCover(props.kind, element, image), { flush: 'post' });
onBeforeUnmount(() => registerDetailCover(props.kind, null));
const brokenImages = ref<string[]>([]);
const hoveredPreview = ref<string | null>(null);
const previewRatios = ref<Record<string, number>>({});
const hasImage = (url: string) => Boolean(url && !brokenImages.value.includes(url));
const coverVisible = computed(() => hasImage(props.selection?.cover || ''));
// 预览保留到新牌落定，再随扫光换图，避免新封面尚未翻开就提前跳内容。
const visiblePreviews = useDrawPreviews(() => props.selection, () => props.phase, () => props.active);
watch(() => props.selection, () => { brokenImages.value = []; hoveredPreview.value = null; });
watch(visiblePreviews, (previews) => {
  hoveredPreview.value = null;
  previewRatios.value = Object.fromEntries(previews.filter((item) => previewRatios.value[item.key]).map((item) => [item.key, previewRatios.value[item.key]]));
});
watch(() => props.phase, (phase) => { if (phase !== 'idle') hoveredPreview.value = null; });
function imageError(event: Event): void {
  brokenImages.value.push((event.currentTarget as HTMLImageElement).getAttribute('src') || '');
}
let detailTimer: ReturnType<typeof setTimeout> | undefined;
let acceptedClick = false;
function cancelDetail(): void { pressed.value = false; clearTimeout(detailTimer); detailTimer = undefined; }
function clickCard(event: MouseEvent): void {
  cancelDetail();
  acceptedClick = props.allowActivate(event);
  if (!acceptedClick || !props.active || props.busy || props.loading) return;
  // 等待双击判定，避免第一次 click 先切走页面；键盘激活无需等待。
  if (event.detail === 0) { if (props.selection) emit('detail'); return; }
  if (event.detail !== 1) return;
  pressed.value = true;
  detailTimer = setTimeout(() => {
    detailTimer = undefined;
    pressed.value = false;
    if (props.active && props.selection && !props.busy && !props.loading) emit('detail');
  }, 240);
}
function doubleClickCard(event: MouseEvent): void {
  cancelDetail();
  if (acceptedClick && props.active && !props.busy && !props.loading) emit('draw', event);
}
function cardPointerDown(event: PointerEvent): void {
  cancelDetail();
  if (!props.busy && !props.loading) emit('cardPointerDown', event);
}
watch(() => [props.active, props.busy, props.loading, props.selection], cancelDetail);
onBeforeUnmount(cancelDetail);
function flipEnd(): void { emit('animationEnd', 'closing'); }
function tuckEnd(): void { emit('animationEnd', 'tucking'); }
function revealEnd(): void { emit('animationEnd', 'opening'); }
function settleEnd(): void { emit('animationEnd', 'settling'); }
function previewEnter(key: string): void { if (!props.busy) hoveredPreview.value = key; }
function previewLeave(): void { hoveredPreview.value = null; }
function recordPreviewRatio(key: string, event: Event): void {
  const image = event.currentTarget as HTMLImageElement;
  if (props.kind === 'book' && image.naturalHeight > 0) previewRatios.value[key] = image.naturalWidth / image.naturalHeight;
}
function previewRatio(preview?: DrawPreview): number {
  return props.kind === 'media' ? 16 / 9 : preview?.aspectRatio || previewRatios.value[preview?.key || ''] || 2 / 3;
}
function previewStyle(preview: DrawPreview): Record<string, string> {
  return { '--preview-ratio': String(previewRatio(preview)) };
}
const previewLayout = computed(() => ({
  '--active-preview-ratio': String(previewRatio(visiblePreviews.value.find(preview => preview.key === hoveredPreview.value))),
  '--preview-count': String(Math.max(1, visiblePreviews.value.length)),
}));
</script>

<template>
  <section class="home-draw-lane" :class="`home-draw-${kind}`" :aria-label="label">
    <h2 class="home-draw-heading">{{ label }}</h2>
    <div class="home-draw-stage">
      <button class="home-draw-cover" :class="[`phase-${phase}`, { 'is-transferring': dragging, 'is-detail-pending': pressed }]" :aria-label="`${label}作品，单击进入详情，双击抽卡`" :aria-busy="busy" :disabled="busy || loading" @click="clickCard" @dblclick="doubleClickCard"
        @pointerdown="cardPointerDown" @pointermove="emit('cardPointerMove', $event)" @pointerup="emit('cardPointerUp', $event)" @pointercancel="emit('cardPointerCancel')" @lostpointercapture="emit('cardPointerCancel')" @dragstart.prevent>
        <span class="home-draw-deck-bottom home-draw-deck-base" aria-hidden="true"><HomeCardBack /></span>
        <span class="home-draw-deck-bottom home-draw-deck-middle" aria-hidden="true"><HomeCardBack /></span>
        <span class="home-draw-incoming" @animationend.self="settleEnd">
          <span class="home-draw-flipper" @animationend.self="revealEnd">
            <span ref="coverFace" class="home-draw-face home-draw-front" :class="{ 'home-detail-cover-hidden': transitioning && coverFlightVisible }">
              <img ref="coverImage" v-if="coverVisible" :src="selection!.cover" :alt="selection!.title" @error="imageError" />
              <span v-else class="home-draw-placeholder">
                <span class="fluent-icon" aria-hidden="true">&#xE8A5;</span>
                <span>{{ loading || busy ? '正在抽取' : selection ? '暂无封面' : '暂无作品' }}</span>
              </span>
            </span>
            <span class="home-draw-face home-draw-back"><HomeCardBack /></span>
          </span>
        </span>
        <!-- 旧顶牌拥有独立快照：先翻背，再绕开牌堆滑入底部，不能中途换成新封面。 -->
        <span v-if="retiring" class="home-draw-retiring" aria-hidden="true" @animationend.self="tuckEnd">
          <span class="home-retiring-flipper" @animationend.self="flipEnd">
            <span class="home-draw-face home-draw-front">
              <img v-if="hasImage(retiring.cover)" :src="retiring.cover" alt="" @error="imageError" />
            </span>
            <span class="home-draw-face home-draw-back"><HomeCardBack /></span>
          </span>
        </span>
      </button>
      <div class="home-draw-previews" :style="previewLayout" :class="{ 'is-short': visiblePreviews.length < 3, 'is-pair': visiblePreviews.length === 2, 'is-refreshing': phase === 'settling', 'is-changing': phase !== 'idle' && phase !== 'settling', 'has-hover': hoveredPreview !== null }" @pointerleave="previewLeave">
        <figure v-for="preview in visiblePreviews" :key="preview.key" class="home-draw-preview" :style="previewStyle(preview)" :class="{ 'is-expanded': hoveredPreview === preview.key }" @pointerenter="previewEnter(preview.key)" @pointerleave="previewLeave">
          <div class="home-draw-preview-image">
            <img v-if="hasImage(preview.image)" :src="preview.image" :alt="preview.label" @load="recordPreviewRatio(preview.key, $event)" @error="imageError" />
            <span v-else class="home-preview-empty">暂无截图</span>
          </div>
        </figure>
      </div>
    </div>
    <div class="home-draw-copy">
      <p class="home-draw-title" :title="selection?.title">{{ selection?.title || '\u00a0' }}</p>
      <p v-if="error" class="home-draw-error" role="status" :title="error">{{ error }}</p>
    </div>
  </section>
</template>
