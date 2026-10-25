<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
const props = defineProps<{ src: string; alt: string; jacket?: boolean }>();
const emit = defineEmits<{ node: [element: HTMLImageElement | null] }>();
const element = ref<HTMLImageElement | null>(null);
const failed = ref(false);
watch(() => props.src, () => { failed.value = false; });
watch(element, value => emit('node', value), { flush: 'post' });
onBeforeUnmount(() => emit('node', null));
</script>
<template>
  <img v-if="src && !failed" ref="element" class="shared-cover-image" :class="{ 'shared-jacket-image': jacket }"
    :src="src" :alt="alt" decoding="async" @error="failed = true">
</template>
<style scoped>
.shared-cover-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.shared-jacket-image { left: auto; right: 0; width: 200%; max-width: none; object-position: 100% 50%; }
</style>
