<script setup lang="ts">
defineProps<{ slow: boolean; error: boolean; label: string }>();
</script>
<template>
  <div class="library-stats-placeholder" :class="{ 'has-error': error }" role="status" :aria-label="`${label}统计${error ? '加载失败' : '加载中'}`">
    <div class="library-stats-placeholder-metrics" aria-hidden="true"><div v-for="index in 3" :key="index"><i></i><span></span></div></div>
    <div class="library-stats-section">
      <div class="library-stats-placeholder-status"><span v-if="error">统计加载失败，请重试</span><span v-else-if="slow">正在统计{{ label }}…</span><i v-else class="library-stats-skeleton"></i></div>
      <div class="library-stats-placeholder-bar library-stats-skeleton" aria-hidden="true"></div>
      <div v-for="index in 5" :key="index" class="library-stats-placeholder-row" aria-hidden="true"><i class="library-stats-skeleton"></i><span class="library-stats-skeleton"></span></div>
    </div>
  </div>
</template>
