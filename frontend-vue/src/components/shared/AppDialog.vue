<script setup lang="ts">
import { inject, type Ref, nextTick, onBeforeUnmount, ref, watch } from 'vue';
const props = withDefaults(defineProps<{ open: boolean; title: string; width?: string; dialogClass?: string; allowWhileSuspended?: boolean }>(), { width: '650px', allowWhileSuspended: false });
const emit = defineEmits<{ close: [] }>();
const suspended = inject<Ref<boolean>>('suspendDialogs', ref(false));
const element = ref<HTMLDialogElement | null>(null);
watch(suspended, value => { if (value && props.open && !props.allowWhileSuspended) emit('close'); });
watch(() => props.open && (!suspended.value || props.allowWhileSuspended), async open => {
  await nextTick();
  if (open && element.value && !element.value.open) element.value.showModal();
  if (!open) element.value?.close();
}, { immediate: true });
function outside(event: MouseEvent): void {
  const dialog = element.value;
  if (!dialog || event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) emit('close');
}
onBeforeUnmount(() => element.value?.close());
</script>
<template>
  <Teleport to="body">
    <dialog v-if="open" ref="element" class="settings-dialog" :class="dialogClass" :style="{ '--settings-dialog-width': width }" :aria-label="title" @keydown.stop @cancel.prevent="emit('close')" @click="outside">
      <header class="settings-dialog-head"><h3>{{ title }}</h3><button class="settings-dialog-close" :aria-label="`关闭${title}`" @click="emit('close')">×</button></header>
      <div class="settings-dialog-body"><slot /></div>
    </dialog>
  </Teleport>
</template>
