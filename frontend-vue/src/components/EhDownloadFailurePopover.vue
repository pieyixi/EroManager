<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import type { EhDownloadHistory } from '../stores/ehDownload';

const props = defineProps<{ item: EhDownloadHistory }>();
const emit = defineEmits<{ retryPage: [page: number] }>();
const anchor = ref<HTMLElement | null>(null);
const visible = ref(false);
const placement = ref({ left: '0px', top: '0px' });
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function cancelClose(): void { if (closeTimer) clearTimeout(closeTimer); closeTimer = undefined; }
function show(): void {
  cancelClose();
  const rect = anchor.value?.getBoundingClientRect();
  if (!rect) return;
  const width = Math.min(300, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  const top = window.innerHeight - rect.bottom >= 245
    ? rect.bottom + 7
    : Math.max(12, rect.top - 245);
  placement.value = { left: `${left}px`, top: `${top}px` };
  visible.value = true;
}
function hideSoon(): void {
  cancelClose();
  closeTimer = setTimeout(() => { visible.value = false; }, 140);
}
function retryPage(page: number): void { visible.value = false; emit('retryPage', page); }
onBeforeUnmount(cancelClose);
</script>

<template>
  <span class="eh-download-failure-anchor eh-download-status-badge failed" @pointerenter="show" @pointerleave="hideSoon">
    <button ref="anchor" type="button" :aria-expanded="visible" :aria-label="item.error ? '查看下载错误详情' : `查看 ${item.failures.length} 个失败页面的详情`" @focus="show" @click="show" @keydown.esc="visible = false"><i class="eh-download-status-mark" aria-hidden="true"></i>{{ item.error ? '下载失败' : `失败 ${item.failures.length} 页` }}</button>
  </span>
  <Teleport to="body">
    <div v-if="visible" class="eh-download-failure-popover" :style="placement" role="note" @pointerenter="cancelClose" @pointerleave="hideSoon" @keydown.esc="visible = false">
      <strong>{{ item.error ? '下载错误' : `失败页面 · ${item.failures.length}` }}</strong>
      <p v-if="item.error">{{ item.error }}</p>
      <div v-for="failure in item.failures" :key="failure.page" class="eh-download-failure-row">
        <span>第 {{ failure.page }} 页 · {{ failure.reason }}</span>
        <button type="button" @click="retryPage(failure.page)">重试</button>
      </div>
    </div>
  </Teleport>
</template>
