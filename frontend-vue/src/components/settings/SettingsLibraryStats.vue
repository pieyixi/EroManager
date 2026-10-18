<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppDialog from '../shared/AppDialog.vue';
import { useLibraryConsoleStore } from '../../stores/libraryConsole';
import { useEhSettingsStore } from '../../stores/ehSettings';
import { useArchiveStore } from '../../stores/archive';
import { averageSize, categoryDistribution, sizeParts } from '../../features/settings/statistics';
import { useMetricAlignment } from '../../features/settings/useMetricAlignment';
import { useStatsLoading } from '../../features/settings/useStatsLoading';
import LibraryStatsPlaceholder from './LibraryStatsPlaceholder.vue';
import '../../assets/styles/library-stats.css';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const media = useLibraryConsoleStore(), books = useEhSettingsStore(), archive = useArchiveStore();
const refreshing = ref(false), error = ref('');
const mediaMetrics = ref<HTMLElement | null>(null), bookMetrics = ref<HTMLElement | null>(null);
const mediaMetricStyle = useMetricAlignment(mediaMetrics), bookMetricStyle = useMetricAlignment(bookMetrics);
// 两库共享呈现时机：快的一侧也等待，避免半张骨架、半张数据交替出现。
const loading = computed(() => refreshing.value || media.summaryLoading || books.dashboardLoading);
const { slow } = useStatsLoading(() => props.open, () => loading.value);
const mediaSize = computed(() => sizeParts(media.summary.total_bytes));
const bookSize = computed(() => sizeParts(books.ehDashboard.total_bytes));
const allCategories = computed(() => categoryDistribution(books.ehDashboard.categories));
const categories = computed(() => allCategories.value.slice(0, 5));
const categoryTotal = computed(() => allCategories.value.reduce((sum, item) => sum + item.count, 0));
const remainingCategoryCount = computed(() => categoryTotal.value - categories.value.reduce((sum, item) => sum + item.count, 0));
const remainingCategoryPercent = computed(() => categoryTotal.value ? remainingCategoryCount.value / categoryTotal.value * 100 : 0);
const archivePercent = computed(() => Math.min(100, Math.max(0, media.archivePercent)));
const episodesPerWork = computed(() => media.totalWorks ? (media.summary.episode_count / media.totalWorks).toFixed(1) : '—');
const sizePerWork = computed(() => averageSize(media.summary.total_bytes, media.totalWorks).split(' '));
const sizePerEpisode = computed(() => averageSize(media.summary.total_bytes, media.summary.episode_count).split(' '));

async function refresh(): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true; error.value = '';
  try {
    const results = await Promise.allSettled([
      media.connected ? media.loadSummary() : Promise.resolve(true),
      books.connected ? books.loadDashboard() : Promise.resolve(true),
    ]);
    const failed = results.flatMap((result, index) => result.status === 'rejected' || !result.value ? [index === 0 ? '里番' : '本子'] : []);
    if (failed.length) error.value = `${failed.join('、')}统计刷新失败${media.summaryLoaded || books.dashboardLoaded ? '，已保留现有数据' : ''}`;
  } finally { refreshing.value = false; }
}
function openUnarchived(): void { emit('close'); void archive.openUnarchivedPage(); }
watch(() => props.open, open => { if (open) void refresh(); }, { immediate: true });
</script>

<template>
  <AppDialog :open="open" title="资料库数据" width="920px" dialog-class="library-stats-dialog" @close="emit('close')">
    <section class="library-stats-grid" aria-label="库概览" :aria-busy="loading">
      <article class="library-stats-card" aria-label="里番库统计" :aria-busy="loading">
        <header class="library-stats-card-head"><h3>里番库</h3><span class="library-stats-pill" :class="{ 'is-disconnected': !media.connected }"><i aria-hidden="true"></i>{{ media.connected ? '已连接' : '未连接' }}</span></header>
        <span class="library-stats-path" :title="media.mediaPath">{{ media.connected ? media.mediaPath : '尚未设置目录' }}</span>
        <Transition name="library-stats-content" mode="out-in">
        <div v-if="!loading && (media.summaryLoaded || !media.connected)" key="media-data" class="library-stats-body">
        <div ref="mediaMetrics" class="library-stats-numbers" :style="mediaMetricStyle">
          <div><b id="metricTotalWorks" :class="{ 'is-long': media.totalWorks > 999999 }"><span class="library-stats-value">{{ media.totalWorks }}</span></b><span>部作品</span></div>
          <div><b id="metricEpisodes" :class="{ 'is-long': media.summary.episode_count > 999999 }"><span class="library-stats-value">{{ media.summary.episode_count }}</span></b><span>视频总集数</span></div>
          <div><b id="metricSize"><span class="library-stats-value">{{ mediaSize.value }}</span><small>{{ mediaSize.unit }}</small></b><span>媒体库容量</span></div>
        </div>
        <div class="library-stats-section">
          <div class="library-stats-row"><span>建档进度</span><strong id="metricProgress">{{ archivePercent }}%</strong></div>
          <div class="library-stats-bar" role="progressbar" aria-label="建档进度" :aria-valuenow="archivePercent" aria-valuemin="0" aria-valuemax="100"><i id="archiveRatioBar" :style="{ width: `${archivePercent}%` }"></i></div>
          <div class="library-stats-kv"><span>已建档</span><strong id="metricArchived">{{ media.archivedCount }}<small>部</small></strong></div>
          <button class="library-stats-kv library-stats-unarchived" :disabled="!media.unarchivedCount" @click="openUnarchived"><span>未建档</span><strong id="metricUnarchived">{{ media.unarchivedCount }}<small>部</small></strong></button>
          <div class="library-stats-kv"><span>每部集数</span><strong>{{ episodesPerWork }}<small v-if="media.totalWorks">集</small></strong></div>
          <div class="library-stats-kv"><span>每部容量</span><strong>{{ sizePerWork[0] }}<small v-if="sizePerWork[1]">{{ sizePerWork[1] }}</small></strong></div>
          <div class="library-stats-kv"><span>每集容量</span><strong>{{ sizePerEpisode[0] }}<small v-if="sizePerEpisode[1]">{{ sizePerEpisode[1] }}</small></strong></div>
        </div>
        </div>
        <LibraryStatsPlaceholder v-else key="media-loading" label="资料库" :slow="slow" :error="!loading && !!media.summaryError" />
        </Transition>
      </article>
      <article class="library-stats-card" aria-label="本子库统计" :aria-busy="loading">
        <header class="library-stats-card-head"><h3>本子库</h3><span class="library-stats-pill" :class="{ 'is-disconnected': !books.connected }"><i aria-hidden="true"></i>{{ books.connected ? '已连接' : '未连接' }}</span></header>
        <span class="library-stats-path" :title="books.ehLibraryPath">{{ books.ehLibraryPath || '尚未设置目录' }}</span>
        <Transition name="library-stats-content" mode="out-in">
        <div v-if="!loading && (books.dashboardLoaded || !books.connected)" key="book-data" class="library-stats-body">
        <div ref="bookMetrics" class="library-stats-numbers" :style="bookMetricStyle">
          <div><b :class="{ 'is-long': books.ehDashboard.total_count > 999999 }"><span class="library-stats-value">{{ books.ehDashboard.total_count }}</span></b><span>部作品</span></div>
          <div><b><span class="library-stats-value">{{ bookSize.value }}</span><small>{{ bookSize.unit }}</small></b><span>总容量</span></div>
          <div><b><span class="library-stats-value">{{ allCategories.length }}</span></b><span>个分类</span></div>
        </div>
        <div class="library-stats-section">
          <div class="library-stats-row"><span>分类占比</span><strong>{{ categoryTotal }} 部</strong></div>
          <div v-if="categories.length" class="library-stats-stack" role="img" aria-label="数量最多的五个本子分类占比"><i v-for="item in categories" :key="item.category" :style="{ flex: `${item.count} 1 0`, background: item.color }" :title="`${item.label} ${item.count} 部（${item.percent.toFixed(1)}%）`"></i><span v-if="remainingCategoryCount" class="library-stats-other" :style="{ flex: `${remainingCategoryCount} 1 0` }" :title="`其它 ${remainingCategoryPercent.toFixed(1)}%`"></span></div>
          <div v-else class="library-stats-empty">暂无分类数据</div>
          <div class="library-stats-legend"><div v-for="item in categories" :key="item.category" class="library-stats-category"><i :style="{ background: item.color }" aria-hidden="true"></i><span :title="item.label">{{ item.label }}</span><strong>{{ item.count }}</strong><span class="library-stats-percentage">{{ item.percent.toFixed(1) }}%</span></div></div>
        </div>
        </div>
        <LibraryStatsPlaceholder v-else key="book-loading" label="资料库" :slow="slow" :error="!loading && !!books.dashboardError" />
        </Transition>
      </article>
    </section>
    <footer class="library-stats-footer"><p v-if="error" role="alert">{{ error }}</p><button class="library-stats-refresh" :disabled="loading" @click="refresh">{{ loading ? '刷新中…' : '刷新统计' }}</button></footer>
  </AppDialog>
</template>
