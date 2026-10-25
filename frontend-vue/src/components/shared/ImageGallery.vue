<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue';
import { galleryLayout, type GalleryAnchor } from './galleryLayout';
const props = defineProps<{ images: Array<{ path: string; src: string }>; active: boolean; collapsible?: boolean }>();
const emit = defineEmits<{ request: [paths: string[]] }>();
const selected = ref<number | null>(null);
const anchor = ref<GalleryAnchor>();
const element = ref<HTMLElement | null>(null);
const width = ref(0);
const ready = ref(false);
const open = ref(false), hovering = ref(false);
const folded = computed(() => !!props.collapsible && !open.value);
const layout = computed(() => galleryLayout(width.value, props.images.length, selected.value, anchor.value));
const height = computed(() => folded.value ? layout.value.tileHeight + 30 : layout.value.height);
const nodes = new Map<Element, string>();
let observer: IntersectionObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let frame = 0;
function register(node: Element | ComponentPublicInstance | null, path: string): void {
  for (const [old, value] of nodes) if (value === path && old !== node) { observer?.unobserve(old); nodes.delete(old); }
  if (!(node instanceof Element) || !path) return;
  nodes.set(node, path); observer?.observe(node);
}
function expand(index: number, event: Event): void {
  if (!props.active || folded.value || selected.value === index || !element.value) return;
  const target = event.currentTarget as HTMLElement;
  const bounds = target.getBoundingClientRect(), gallery = element.value.getBoundingClientRect();
  anchor.value = { row: Math.max(0, Math.round((bounds.top - gallery.top) / (layout.value.tileHeight + 10))),
    column: Math.max(0, Math.round((bounds.left - gallery.left) / (layout.value.tileWidth + 10))) };
  selected.value = index;
  const path = props.images[index]?.path; if (path) emit('request', [path]);
}
function collapse(): void { selected.value = null; anchor.value = undefined; }
function fold(): void { collapse(); open.value = false; hovering.value = false; }
function outside(event: PointerEvent): void {
  if (!props.active || !props.collapsible || !open.value || !(event.target instanceof Element)) return;
  // 图片和其它可操作控件保留自己的动作；点击其余空白处收回照片堆。
  if (!event.target.closest('button, input, textarea, select, a, [role="dialog"]')) fold();
}
function openStack(): void { if (folded.value) { collapse(); open.value = true; } }
function tileStyle(index: number) {
  const tile = layout.value.tiles[index]!;
  const depth = Math.min(index, 3), fan = hovering.value ? 1.65 : 1;
  const x = folded.value ? 8 + depth * 5 * fan : tile.x;
  const y = folded.value ? 6 + depth * 5 * fan : tile.y;
  const rotation = folded.value ? [0, -2.8, 2.5, -1.5][depth]! * fan : 0;
  return { width: `${layout.value.tileWidth}px`, height: `${layout.value.tileHeight}px`,
    transform: `translate3d(${x}px, ${y}px, 0) rotate(${rotation}deg) scale(${folded.value ? 1 : tile.scale})`,
    opacity: folded.value && index > 3 ? 0 : 1,
    zIndex: folded.value ? props.images.length - index : selected.value === index ? props.images.length + 1 : 1 };
}
function focusOut(event: FocusEvent): void { if (!element.value?.contains(event.relatedTarget as Node | null)) collapse(); }
watch(() => props.active, async active => {
  if (!active) fold();
  else { await nextTick(); nodes.forEach((_, node) => { observer?.unobserve(node); observer?.observe(node); }); }
});
watch(() => props.images.map(image => image.path).join('\n'), fold);
watch(folded, async () => { await nextTick(); nodes.forEach((_, node) => { observer?.unobserve(node); observer?.observe(node); }); });
watch(() => props.images, async images => {
  if (props.active && images.some(image => image.path && !image.src)) {
    await nextTick(); nodes.forEach((_, node) => { observer?.unobserve(node); observer?.observe(node); });
  }
});
onMounted(() => {
  document.addEventListener('pointerdown', outside, true);
  resizeObserver = new ResizeObserver(entries => {
    const measured = entries[0]?.contentRect.width || 0;
    if (measured < 1 || Math.abs(measured - width.value) < .5) return;
    const firstMeasurement = width.value < 1;
    collapse(); width.value = measured;
    // 展开后滚动条也可能改变宽度，不能把这类重测当初次挂载而关闭位移动画。
    if (firstMeasurement) {
      cancelAnimationFrame(frame);
      void nextTick(() => { frame = requestAnimationFrame(() => { ready.value = true; }); });
    }
  });
  if (element.value) resizeObserver.observe(element.value);
  observer = new IntersectionObserver(entries => {
    if (!props.active) return;
    const paths = entries.filter(entry => entry.isIntersecting && (!folded.value || props.images.slice(0, 4).some(image => image.path === nodes.get(entry.target)))).map(entry => nodes.get(entry.target) || '').filter(Boolean);
    if (paths.length) emit('request', paths);
  }, { rootMargin: '100px' });
  nodes.forEach((_, node) => observer?.observe(node));
});
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside, true); observer?.disconnect(); resizeObserver?.disconnect(); cancelAnimationFrame(frame); });
</script>
<template>
  <div ref="element" class="shared-image-gallery" :class="{ ready, folded }" :style="{ height: `${height}px` }" @pointerleave="hovering = false; collapse()" @focusout="focusOut" @keydown.esc="collapsible ? fold() : collapse()">
    <button v-for="(image, i) in images" :key="`${i}-${image.path}`" :ref="el => register(el, image.path)" type="button" class="gallery-thumbnail" :class="{ expanded: !folded && selected === i }" :style="tileStyle(i)" :aria-label="folded && i === 0 ? '展开预览图' : `预览图 ${i + 1}`" :aria-expanded="folded ? false : collapsible && i === 0 ? true : selected === i" :aria-hidden="folded && i > 0 ? true : undefined" :tabindex="folded && i > 0 ? -1 : 0" @click="openStack" @pointerenter="hovering = true" @pointermove="expand(i, $event)" @focus="expand(i, $event)">
      <img v-if="image.src" :src="image.src" :alt="`预览图 ${i + 1}`" loading="lazy" decoding="async">
      <span v-else>{{ image.path ? '预览图加载中' : '图片暂不可用' }}</span>
    </button>
  </div>
</template>
<style scoped>
.shared-image-gallery { position: relative; width: 100%; overflow-anchor: none; }
.shared-image-gallery.ready { transition: height .52s cubic-bezier(.22,.8,.28,1); }
.gallery-thumbnail { position: absolute; top: 0; left: 0; overflow: hidden; transform-origin: 0 0; border: 1px solid var(--line); border-radius: 7px; background: var(--media-bg); cursor: default; color: var(--soft); font: 11px/1.4 inherit; }
.ready .gallery-thumbnail { transition: transform .52s cubic-bezier(.22,.8,.28,1), opacity .36s ease, box-shadow .36s; }
.folded .gallery-thumbnail { border-color: var(--panel); box-shadow: 0 0 0 2px var(--panel), 0 2px 8px var(--shell-shadow); cursor: pointer; }
.folded .gallery-thumbnail:not(:first-child) { pointer-events: none; }
.gallery-thumbnail.expanded { z-index: 2; box-shadow: 0 6px 18px var(--shell-shadow); }
.gallery-thumbnail img { display: block; width: 100%; height: 100%; object-fit: cover; }
.gallery-thumbnail:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
</style>
