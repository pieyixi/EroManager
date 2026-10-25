<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { AvWork } from '../../api/contracts/av';
import { accountScope } from '../../api/accountContext';
import { mediaApi } from '../../api/commands/media';
import { useAvLibraryStore, type AvFilterKey } from '../../stores/avLibrary';
import { useNavigationStore } from '../../stores/navigation';
import { useAccountsStore } from '../../stores/accounts';
import ImageGallery from '../shared/ImageGallery.vue';
import AvMagnetPopover from './AvMagnetPopover.vue';
import AvVideoList from './AvVideoList.vue';

const props = defineProps<{ work: AvWork }>();
const library = useAvLibraryStore();
const navigation = useNavigationStore();
const accounts = useAccountsStore();
const active = computed(() => navigation.activePage === 'page-detail' && !accounts.locked && !accounts.selecting);
const previewCache = ref<Record<string, string>>({});
const pendingImages = new Set<string>();
let previewRevision = 0;
function releasePreviews(): void { previewRevision++; previewCache.value = {}; pendingImages.clear(); }
watch([() => props.work.code, active, () => library.imageRevision], releasePreviews);
onBeforeUnmount(releasePreviews);
async function loadPreviews(requested: string[]): Promise<void> {
  if (!active.value) return;
  const paths = [...new Set(requested.filter(path => path && !path.startsWith('data:image/') && !previewCache.value[path] && !pendingImages.has(path)))];
  if (!paths.length) return;
  const revision = previewRevision, owner = accountScope(); paths.forEach(path => pendingImages.add(path));
  try {
    const images = await mediaApi.loadImages(paths);
    if (revision === previewRevision && owner === accountScope() && active.value) Object.assign(previewCache.value, Object.fromEntries(images));
  } catch { /* 单张失败保留同尺寸占位，不阻塞其它预览。 */ }
  finally { if (revision === previewRevision) paths.forEach(path => pendingImages.delete(path)); }
}
const rows = computed<Array<{ label: string; values: string[]; filter?: AvFilterKey }>>(() => [
  { label: '番号', values: [props.work.code] },
  { label: '时长', values: props.work.duration_minutes ? [`${props.work.duration_minutes} 分钟`] : [] },
  { label: '发行日期', values: [props.work.release_date], filter: 'year' },
  { label: '片商', values: [props.work.studio], filter: 'studio' },
  { label: '系列', values: [props.work.series], filter: 'series' },
  { label: '女优', values: props.work.actresses.map(actor => actor.name) },
  { label: 'Tag', values: props.work.tags, filter: 'tag' },
].filter(row => row.values.some(Boolean)) as Array<{ label: string; values: string[]; filter?: AvFilterKey }>);
const previews = computed(() => props.work.previews.map(path => ({ path, src: path.startsWith('data:image/') ? path : previewCache.value[path] || '' })));
function jump(row: typeof rows.value[number], value: string): void {
  if (row.filter) library.jumpToFilter(row.filter, row.filter === 'year' ? value.slice(0, 4) : value);
  else if (row.label === '女优') { library.search = value; library.mode = 'code'; library.resetPages(); navigation.showPage('page-av-library'); }
}
</script>
<template>
  <section class="detail-main av-detail-main">
    <div class="detail-title">{{ work.code }} {{ work.title }}</div>
    <div class="detail-tags">
      <div v-for="row in rows" :key="row.label" class="detail-tag-row">
        <span class="detail-section-title">{{ row.label }}</span>
        <button v-for="value in row.values.filter(Boolean)" :key="value" class="detail-tag" :class="{ clickable: row.filter || row.label === '女优' }" @click="jump(row, value)">{{ value }}</button>
      </div>
    </div>
  </section>
  <AvVideoList :work="work" />
  <section class="detail-episodes av-preview-panel">
    <div class="episodes-title">预览图 <span>{{ work.previews.length }} 张</span></div>
    <ImageGallery v-if="work.previews.length" :images="previews" :active="active" collapsible @request="loadPreviews" />
    <p v-else class="av-detail-empty">暂无预览图</p>
  </section>
  <AvMagnetPopover :work="work" :active="active" />
</template>
<style scoped>
.av-preview-panel .episodes-title { display: flex; align-items: center; gap: 8px; }
.episodes-title span { color: var(--muted); font-size: 11px; font-weight: 400; }
.av-detail-empty { color: var(--muted); font-size: 12px; padding: 12px 0; }
</style>
