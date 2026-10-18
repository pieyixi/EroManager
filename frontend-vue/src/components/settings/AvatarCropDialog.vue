<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import AppDialog from '../shared/AppDialog.vue';
import ProfileIcon from './ProfileIcon.vue';
import { clampCrop, CROP_STAGE, cropScale, prepareAvatar, renderAvatar, zoomCrop, type CropPosition } from '../../features/settings/avatarCrop';

const props = defineProps<{ file: File }>();
const emit = defineEmits<{ close: []; confirm: [avatar: string] }>();
const stage = ref<HTMLElement | null>(null), image = shallowRef<HTMLImageElement | null>(null);
const position = ref<CropPosition>({ zoom: 1, x: 0, y: 0 });
const loading = ref(true), saving = ref(false), error = ref(''), dragging = ref(false);
let version = 0, pointer: { id: number; x: number; y: number; origin: CropPosition; ratio: number } | null = null;
const dimensions = computed(() => ({ width: image.value?.naturalWidth || 1, height: image.value?.naturalHeight || 1 }));
const imageStyle = computed(() => ({
  width: `${dimensions.value.width * cropScale(dimensions.value, position.value.zoom) / CROP_STAGE * 100}%`,
  left: `${50 + position.value.x / CROP_STAGE * 100}%`, top: `${50 + position.value.y / CROP_STAGE * 100}%`,
}));
watch(() => props.file, async file => {
  const request = ++version; loading.value = true; error.value = ''; image.value = null;
  try { const prepared = await prepareAvatar(file); if (request === version) { image.value = prepared; position.value = { zoom: 1, x: 0, y: 0 }; } }
  catch { if (request === version) error.value = '图片无法读取，请重新选择'; }
  finally { if (request === version) loading.value = false; }
}, { immediate: true });
function zoom(value: number, anchor?: { x: number; y: number }): void { if (image.value) position.value = zoomCrop(dimensions.value, position.value, value, anchor); }
function wheel(event: WheelEvent): void {
  const rect = stage.value?.getBoundingClientRect(); if (!rect) return;
  const ratio = CROP_STAGE / rect.width;
  zoom(position.value.zoom * Math.exp(-event.deltaY * .0015), { x: (event.clientX - rect.left - rect.width / 2) * ratio, y: (event.clientY - rect.top - rect.height / 2) * ratio });
}
function start(event: PointerEvent): void {
  if (!image.value || event.button !== 0 || pointer) return;
  const element = stage.value; if (!element) return;
  event.preventDefault(); element.focus(); element.setPointerCapture(event.pointerId);
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: { ...position.value }, ratio: CROP_STAGE / element.getBoundingClientRect().width };
  dragging.value = true;
}
function move(event: PointerEvent): void {
  if (!pointer || event.pointerId !== pointer.id) return;
  position.value = clampCrop(dimensions.value, { zoom: position.value.zoom,
    x: pointer.origin.x + (event.clientX - pointer.x) * pointer.ratio, y: pointer.origin.y + (event.clientY - pointer.y) * pointer.ratio });
}
function end(): void {
  const element = stage.value;
  if (pointer && element?.hasPointerCapture(pointer.id)) element.releasePointerCapture(pointer.id);
  pointer = null; dragging.value = false;
}
function keydown(event: KeyboardEvent): void {
  const offsets: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const offset = offsets[event.key];
  if (offset) { event.preventDefault(); const step = event.shiftKey ? 1 : 10; position.value = clampCrop(dimensions.value, { ...position.value, x: position.value.x + offset[0] * step, y: position.value.y + offset[1] * step }); }
}
async function confirm(): Promise<void> {
  if (!image.value || saving.value) return; saving.value = true; end();
  try { emit('confirm', renderAvatar(image.value, position.value)); }
  catch { error.value = '头像生成失败，请重试'; }
  finally { saving.value = false; }
}
onBeforeUnmount(() => { version++; end(); image.value = null; });
</script>
<template>
  <AppDialog :open="true" title="编辑头像" width="400px" dialog-class="profile-dialog avatar-crop-dialog" @close="emit('close')">
    <div ref="stage" class="avatar-crop-stage" :class="{ 'is-dragging': dragging }" tabindex="0" role="group" aria-label="拖动图片调整圆形头像" @pointerdown="start" @pointermove="move" @pointerup="end" @pointercancel="end" @lostpointercapture="end" @wheel.prevent="wheel" @keydown="keydown">
      <img v-if="image" :src="image.src" :style="imageStyle" alt="待裁剪头像" draggable="false">
      <div v-if="image" class="avatar-crop-circle" aria-hidden="true"></div>
      <span v-if="loading" class="avatar-crop-status" role="status">正在读取图片…</span>
      <span v-else-if="!image" class="avatar-crop-status" role="alert">{{ error }}</span>
    </div>
    <p class="avatar-crop-hint">拖动调整位置，滚轮缩放</p>
    <div class="avatar-crop-zoom"><button class="avatar-zoom-button" aria-label="缩小头像" :disabled="!image || position.zoom <= 1" @click="zoom(position.zoom - .1)"><ProfileIcon name="minus" /></button><input type="range" aria-label="头像缩放" min="1" max="5" step=".01" :value="position.zoom" :style="{ '--avatar-zoom-progress': `${(position.zoom - 1) / 4 * 100}%` }" :disabled="!image" @input="zoom(Number(($event.target as HTMLInputElement).value))"><button class="avatar-zoom-button" aria-label="放大头像" :disabled="!image || position.zoom >= 5" @click="zoom(position.zoom + .1)"><ProfileIcon name="plus" /></button></div>
    <p v-if="error && image" class="profile-error" role="alert">{{ error }}</p>
    <div class="profile-dialog-actions"><button class="profile-action" @click="emit('close')">取消</button><button class="profile-action profile-action-primary" :disabled="!image || saving" @click="confirm">确定</button></div>
  </AppDialog>
</template>
