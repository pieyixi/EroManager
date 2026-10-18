<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { paginationItems } from './pagination';

const props = defineProps<{
  currentPage: number;
  totalPages: number;
  total: number;
  jumpInputId?: string;
}>();
const emit = defineEmits<{ change: [page: number] }>();
const pageJump = ref(1);
const items = computed(() => paginationItems(props.currentPage, props.totalPages));
watch(() => props.currentPage, page => { pageJump.value = page; }, { immediate: true });
function change(page: number): void {
  const target = Math.max(1, Math.min(props.totalPages, Math.floor(page) || 1));
  pageJump.value = target;
  emit('change', target);
}
</script>

<template>
  <div class="pagination" aria-label="作品分页">
    <button class="page-btn" aria-label="上一页" :disabled="currentPage <= 1" @click="change(currentPage - 1)">&#8249;</button>
    <template v-for="(item, index) in items" :key="`${item}-${index}`">
      <span v-if="item === 'ellipsis'" class="page-dot">...</span>
      <button v-else class="page-num" :class="{ active: item === currentPage }" :aria-current="item === currentPage ? 'page' : undefined" @click="change(item)">{{ item }}</button>
    </template>
    <button class="page-btn" aria-label="下一页" :disabled="currentPage >= totalPages" @click="change(currentPage + 1)">&#8250;</button>
    <input :id="jumpInputId" v-model.number="pageJump" class="page-jump" aria-label="跳转页码" type="number" min="1" :max="totalPages" @keydown.enter="change(pageJump)">
    <span class="page-total">共 {{ total }} 部</span>
  </div>
</template>

<style scoped>
.page-jump { width: 48px; height: 28px; border: 1px solid var(--line); border-radius: 5px; font-size: 12px; text-align: center; margin: 0 4px; }
.page-total { font-size: 12px; color: var(--soft); }
</style>
