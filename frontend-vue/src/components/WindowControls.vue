<script setup lang="ts">
defineProps<{ maximized: boolean }>();

const emit = defineEmits<{
  minimize: [];
  toggleMaximize: [];
  close: [];
}>();
</script>

<template>
  <div class="window-control-divider"></div>
  <div class="window-controls">
    <button
      class="window-control minimize"
      title="最小化"
      aria-label="最小化"
      @click="emit('minimize')"
    ></button>
    <button
      class="window-control maximize"
      :class="{ restore: maximized }"
      :title="maximized ? '还原' : '最大化'"
      :aria-label="maximized ? '还原' : '最大化'"
      @click="emit('toggleMaximize')"
    ></button>
    <button
      class="window-control close"
      title="关闭"
      aria-label="关闭"
      @click="emit('close')"
    ></button>
  </div>
</template>
