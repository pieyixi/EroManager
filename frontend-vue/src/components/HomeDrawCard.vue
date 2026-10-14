<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { DrawPhase, DrawSelection } from '../stores/home';
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
}>();
const emit = defineEmits<{ draw: [event: MouseEvent]; detail: []; animationEnd: [phase: DrawPhase]; cardPointerDown: [event: PointerEvent]; cardPointerMove: [event: PointerEvent]; cardPointerUp: [event: PointerEvent]; cardPointerCancel: [] }>();
const brokenImages = ref<string[]>([]);
const hoveredPreview = ref<string | null>(null);
const previewRatios = ref<Record<string, number>>({});
const hasImage = (url: string) => Boolean(url && !brokenImages.value.includes(url));
const coverVisible = computed(() => hasImage(props.selection?.cover || ''));
// 预览保留到新牌落定，再随扫光换图，避免新封面尚未翻开就提前跳内容。
const visiblePreviews = computed(() => props.retiring && props.phase !== 'idle' && props.phase !== 'settling'
  ? props.retiring.previews : props.selection?.previews || []);
watch(() => props.selection, () => { brokenImages.value = []; hoveredPreview.value = null; });
watch(visiblePreviews, (previews) => {
  hoveredPreview.value = null;
  previewRatios.value = Object.fromEntries(previews.filter((item) => previewRatios.value[item.key]).map((item) => [item.key, previewRatios.value[item.key]]));
});
watch(() => props.phase, (phase) => { if (phase !== 'idle') hoveredPreview.value = null; });
function imageError(event: Event): void {
  brokenImages.value.push((event.currentTarget as HTMLImageElement).getAttribute('src') || '');
}
function draw(event: MouseEvent): void { emit('draw', event); }
function cardPointerDown(event: PointerEvent): void { if (!props.busy && !props.loading) emit('cardPointerDown', event); }
function detail(): void { emit('detail'); }
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
function previewStyle(key: string): Record<string, string> {
  return { '--preview-ratio': String(props.kind === 'media' ? 16 / 9 : previewRatios.value[key] || 2 / 3) };
}
const previewLayout = computed(() => ({
  '--active-preview-ratio': String(props.kind === 'media' ? 16 / 9 : previewRatios.value[hoveredPreview.value || ''] || 2 / 3),
  '--preview-count': String(Math.max(1, visiblePreviews.value.length)),
}));
</script>

<template>
  <section class="home-draw-lane" :class="`home-draw-${kind}`" :aria-label="label">
    <h2 class="home-draw-heading">{{ label }}</h2>
    <div class="home-draw-stage">
      <button class="home-draw-cover" :class="[`phase-${phase}`, { 'is-transferring': dragging }]" :aria-label="`${label}抽卡`" :aria-busy="busy" :disabled="busy || loading" @click="draw"
        @pointerdown="cardPointerDown" @pointermove="emit('cardPointerMove', $event)" @pointerup="emit('cardPointerUp', $event)" @pointercancel="emit('cardPointerCancel')" @lostpointercapture="emit('cardPointerCancel')" @dragstart.prevent>
        <span class="home-draw-deck-bottom home-draw-deck-base" aria-hidden="true"><HomeCardBack /></span>
        <span class="home-draw-deck-bottom home-draw-deck-middle" aria-hidden="true"><HomeCardBack /></span>
        <span class="home-draw-incoming" @animationend.self="settleEnd">
          <span class="home-draw-flipper" @animationend.self="revealEnd">
            <span class="home-draw-face home-draw-front">
              <img v-if="coverVisible" :src="selection!.cover" :alt="selection!.title" @error="imageError" />
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
        <figure v-for="preview in visiblePreviews" :key="preview.key" class="home-draw-preview" :style="previewStyle(preview.key)" :class="{ 'is-expanded': hoveredPreview === preview.key }" @pointerenter="previewEnter(preview.key)" @pointerleave="previewLeave">
          <div class="home-draw-preview-image">
            <img v-if="hasImage(preview.image)" :src="preview.image" :alt="preview.label" @load="recordPreviewRatio(preview.key, $event)" @error="imageError" />
            <span v-else class="home-preview-empty">暂无截图</span>
          </div>
        </figure>
      </div>
    </div>
    <div class="home-draw-copy">
      <p class="home-draw-title" :title="selection?.title">{{ selection?.title || '\u00a0' }}</p>
      <button class="btn-primary home-draw-detail" :disabled="!selection || busy || loading" @click="detail">进入详情</button>
      <p v-if="error" class="home-draw-error" role="status" :title="error">{{ error }}</p>
    </div>
  </section>
</template>
