<script setup lang="ts">
import StartupBrand from '../shared/StartupBrand.vue';
import WindowControls from '../shared/WindowControls.vue';
import { useShellWindowControls } from '../../features/shell/useShellWindowControls';

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ ready: [] }>();
const { maximized, minimizeWindow, toggleMaximize, closeWindow } = useShellWindowControls();
</script>

<template>
  <Transition name="startup-screen" @after-leave="emit('ready')">
    <section v-if="visible" class="startup-screen" data-tauri-drag-region role="status" aria-label="正在准备资料库" aria-live="polite">
      <header class="startup-chrome" data-tauri-drag-region>
        <WindowControls :maximized="maximized" @minimize="minimizeWindow" @toggle-maximize="toggleMaximize" @close="closeWindow" />
      </header>
      <StartupBrand class="startup-brand" />
    </section>
  </Transition>
</template>

<style scoped>
.startup-screen{position:fixed;inset:0;z-index:20000;display:grid;place-items:center;background:#fafafa}
:root[data-theme="dark"] .startup-screen{background:#1e2025}
.startup-brand{width:clamp(270px,32vw,380px);height:auto;transform:translateY(-1.5vh);pointer-events:none;user-select:none}
.startup-chrome{position:absolute;inset:0 0 auto;height:64px;display:flex;align-items:center;justify-content:flex-end;padding-right:12px}
.startup-chrome :deep(.window-control-divider){display:none}
.startup-screen-leave-active{transition:opacity .38s cubic-bezier(.22,.8,.28,1);pointer-events:none}
.startup-screen-leave-to{opacity:0}
@media(max-width:500px){.startup-brand{width:260px}}
</style>
