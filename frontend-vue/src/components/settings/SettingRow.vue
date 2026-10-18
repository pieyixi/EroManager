<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>
<template>
  <div class="setting-row">
    <div v-if="title || description" class="setting-copy"><span class="setting-title">{{ title }}</span><p v-if="description">{{ description }}</p></div>
    <div class="setting-control"><slot /></div>
  </div>
</template>
