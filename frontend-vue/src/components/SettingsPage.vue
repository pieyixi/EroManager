<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useArchiveStore } from '../stores/archive';
import { formatLibrarySize, isMissingDirectoryItem, type ConsoleItem, type LibraryScan, useLibraryConsoleStore } from '../stores/libraryConsole';
import { useEhSettingsStore } from '../stores/ehSettings';
import { useEhDownloadStore } from '../stores/ehDownload';
import { useNavigationStore } from '../stores/navigation';

const settings = useLibraryConsoleStore();
const eh = useEhSettingsStore();
const download = useEhDownloadStore();
const archive = useArchiveStore();
const navigation = useNavigationStore();
const cookieModalVisible = ref(false);
const activeDrawer = ref<'media' | 'eh' | 'duplicates' | null>(null);

type ScanGroupKey = keyof Pick<LibraryScan, 'changed_works' | 'new_episode_works' | 'new_complete_works' | 'attention_works'>;

const groups: Array<{ key: ScanGroupKey; title: string }> = [
  { key: 'changed_works', title: '已建档内容有变化' },
  { key: 'new_episode_works', title: '发现新增集数' },
  { key: 'new_complete_works', title: '可导入的新作品' },
  { key: 'attention_works', title: '需要检查' },
];

const connected = computed(() => settings.connected);
const ehConnected = computed(() => eh.connected);
const mediaIssueCount = computed(() => groups.reduce((total, group) => total + settings.items(group.key).length, 0));
const ehIssueCount = computed(() => eh.ehScanErrors.length);
const mediaStatus = computed(() => {
  if (settings.scanning) return settings.progressText || '正在扫描媒体库';
  if (mediaIssueCount.value) return `发现 ${mediaIssueCount.value} 项变化`;
  if (settings.scan) return '上次扫描完成，未发现变化';
  return '尚未扫描';
});
const ehStatus = computed(() => {
  if (eh.ehScanning) return eh.ehProgressText || '正在扫描 Eh 库';
  if (ehIssueCount.value) return `发现 ${ehIssueCount.value} 项需要检查`;
  if (eh.ehScanCompleted) return '上次扫描完成，未发现问题';
  return '尚未扫描';
});
const archiveRingStyle = computed(() => ({ '--archive-angle': `${settings.archivePercent * 3.6}deg` }));
const ratioStyle = computed(() => ({ width: `${settings.archivePercent}%` }));
const ehCategoryColors = ['#5f7fca', '#cf718d', '#579887', '#c7924d', '#7f74ad', '#74808c', '#5595a3', '#ba7464', '#81975f', '#9f7395'];
const ehRingStyle = computed(() => {
  const total = eh.ehDashboard.total_count || 1;
  let start = 0;
  const stops = eh.ehDashboard.categories.map((item, index) => {
    const end = start + item.count / total * 360;
    const stop = `${ehCategoryColors[index % ehCategoryColors.length]} ${start}deg ${end}deg`;
    start = end;
    return stop;
  });
  return { background: stops.length ? `conic-gradient(${stops.join(',')})` : 'var(--track)' };
});
const drawerTitle = computed(() => ({ media: '媒体库扫描结果', eh: 'Eh 库扫描结果', duplicates: '重复作品检查' }[activeDrawer.value || 'media']));

function openUnarchived(): void { void archive.openUnarchivedPage(); }
function groupItems(key: ScanGroupKey): ConsoleItem[] { return settings.items(key); }
function continueArchive(key: ScanGroupKey, index: number): void {
  const item = settings.items(key)[index];
  if (item) void archive.openArchiveAssistant(item.folder_path, item.new_episode_numbers?.[0] ?? null);
}
function openDrawer(drawer: 'media' | 'eh' | 'duplicates'): void { activeDrawer.value = drawer; }
async function openDuplicateDrawer(): Promise<void> {
  openDrawer('duplicates');
  await settings.duplicateCheck();
}
function closeDrawer(): void { activeDrawer.value = null; }
function duplicateSize(bytes: number): string { return bytes ? `${Math.round(bytes / 1024 / 1024)} MB` : '未知大小'; }
async function saveEhCookies(): Promise<void> {
  await eh.saveSettings();
  if (eh.ehCredentialsMessage?.kind === 'success') cookieModalVisible.value = false;
}
function handleSettingsKeydown(event: KeyboardEvent): void {
  if (navigation.activePage === 'page-settings' && event.key === 'Escape' && (activeDrawer.value || cookieModalVisible.value)) {
    closeDrawer();
    cookieModalVisible.value = false;
    event.preventDefault();
  }
}
onMounted(() => document.addEventListener('keydown', handleSettingsKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', handleSettingsKeydown));
watch(
  () => navigation.activePage,
  (page) => {
    if (page === 'page-settings') void Promise.all([eh.loadSettings(), eh.loadDashboard()]);
  },
  { immediate: true },
);
</script>

<template>
  <div class="page" :class="{ active: navigation.activePage === 'page-settings' }" id="page-settings">
    <div class="settings settings-console">
      <div class="console-shell settings-shell">
        <section class="settings-dashboard" aria-label="库概览">
          <article class="dashboard-library dashboard-media">
            <header class="dashboard-card-head"><div><i class="dashboard-status-dot" :class="{ warning: !connected }"></i><h2>媒体库</h2><span>{{ connected ? '已连接' : '未连接' }}</span></div><span class="dashboard-path">{{ settings.mediaPath }}</span></header>
            <div class="dashboard-card-body">
              <div class="dashboard-ring archive-ring" id="archiveProgressRing" :style="archiveRingStyle"><div class="dashboard-ring-inner archive-ring-inner"><strong id="metricProgress">{{ settings.archivePercent }}%</strong><span>建档率</span></div></div>
              <div class="dashboard-main-number"><strong id="metricTotalWorks">{{ settings.totalWorks }}</strong><span>部作品</span><div class="dashboard-ratio-track"><i id="archiveRatioBar" :style="ratioStyle"></i></div></div>
              <div class="dashboard-facts"><div><span>已建档</span><strong id="metricArchived">{{ settings.archivedCount }}</strong></div><button @click="openUnarchived"><span>未建档</span><strong id="metricUnarchived">{{ settings.unarchivedCount }}</strong></button><div><span>视频总集数</span><strong id="metricEpisodes">{{ settings.summary.episode_count }}</strong></div><div><span>媒体库容量</span><strong id="metricSize">{{ settings.formattedSize }}</strong></div></div>
            </div>
          </article>
          <article class="dashboard-library dashboard-eh">
            <header class="dashboard-card-head"><div><i class="dashboard-status-dot" :class="{ warning: !ehConnected }"></i><h2>Eh 库</h2><span>{{ ehConnected ? '已连接' : '未连接' }}</span></div><span class="dashboard-path">{{ eh.ehLibraryPath || '尚未设置目录' }}</span></header>
            <div class="dashboard-card-body eh-dashboard-body">
              <div class="dashboard-ring eh-category-ring" :style="ehRingStyle"><div class="dashboard-ring-inner"><strong>{{ eh.ehDashboard.total_count }}</strong><span>部作品</span></div></div>
              <div class="eh-category-legend"><div v-for="(item, index) in eh.ehDashboard.categories" :key="item.category" class="eh-category-item"><i :style="{ background: ehCategoryColors[index % ehCategoryColors.length] }"></i><span>{{ item.label }}</span><strong>{{ item.count }}</strong></div></div>
              <div class="dashboard-facts eh-facts"><div><span>作品数</span><strong>{{ eh.ehDashboard.total_count }}</strong></div><div><span>总容量</span><strong>{{ formatLibrarySize(eh.ehDashboard.total_bytes) }}</strong></div></div>
            </div>
          </article>
        </section>

        <section class="settings-operation-grid" aria-label="库操作">
          <article class="settings-control-card library-control-card">
            <header class="control-card-head"><div><h2>媒体库</h2><span>视频作品目录</span></div><button id="consoleScanButton" class="btn-primary control-primary" :disabled="settings.busy" @click="settings.scanLibraryChanges">{{ settings.scanning ? '扫描中' : '扫描变化' }}</button></header>
            <div class="control-path-row"><input v-model="settings.mediaPath" class="s-input" type="text" id="mediaPath"><button class="btn-secondary" @click="settings.bindMediaLibrary">更改目录</button></div>
            <div class="control-card-state" :class="{ actionable: mediaIssueCount }"><span class="state-line"><i :class="{ busy: settings.scanning, warning: mediaIssueCount }"></i>{{ mediaStatus }}</span><button v-if="mediaIssueCount" class="state-action" @click="openDrawer('media')">查看结果 <span>›</span></button></div>
            <div class="compact-progress" id="consoleProgress" :class="{ active: settings.progressActive }" :aria-hidden="settings.progressActive ? 'false' : 'true'"><div class="compact-progress-track"><span id="consoleProgressBar" :style="{ width: `${settings.progressPercent}%` }"></span></div><span id="consoleProgressText">{{ settings.progressText }}</span></div>
            <div id="libraryMsg" class="visually-hidden"><span v-if="settings.libraryMessage">{{ settings.libraryMessage.text }}</span></div>
          </article>
          <article class="settings-control-card library-control-card">
            <header class="control-card-head"><div><h2>Eh 库</h2><span>本子作品目录</span></div><button class="btn-primary control-primary" :disabled="eh.ehScanning" @click="eh.scanLibrary">{{ eh.ehScanning ? '扫描中' : '扫描变化' }}</button></header>
            <div class="control-path-row"><input v-model="eh.ehLibraryPath" class="s-input" type="text"><button class="btn-secondary" @click="eh.bindLibrary">更改目录</button></div>
            <div class="control-card-state" :class="{ actionable: ehIssueCount }"><span class="state-line"><i :class="{ busy: eh.ehScanning, warning: ehIssueCount }"></i>{{ ehStatus }}</span><button v-if="ehIssueCount" class="state-action" @click="openDrawer('eh')">查看结果 <span>›</span></button></div>
            <div class="compact-progress" :class="{ active: eh.ehProgressActive }" :aria-hidden="eh.ehProgressActive ? 'false' : 'true'"><div class="compact-progress-track"><span :style="{ width: `${eh.ehProgressPercent}%` }"></span></div><span>{{ eh.ehProgressText }}</span></div>
          </article>
          <article class="settings-maintenance-card">
            <section class="maintenance-column">
              <header class="maintenance-head"><div><h2>媒体数据</h2><span>数据库、资料包与重复检查</span></div></header>
              <div class="maintenance-actions"><button class="maintenance-button" :disabled="settings.busy" @click="settings.backupDatabase">备份数据库</button><button class="maintenance-button" :disabled="settings.busy" @click="settings.restoreDatabase">恢复数据库</button><button class="maintenance-button" :disabled="settings.busy" @click="settings.backupDataPackage">备份资料包</button><button class="maintenance-button" :disabled="settings.busy" @click="openDuplicateDrawer">重复检查</button></div>
              <input v-model="settings.backupPath" class="s-input maintenance-path" type="text" id="dbFilePath" placeholder="备份或恢复路径，例如 D:\Ark\hanime-data-backup.zip"><div id="dbMsg" class="maintenance-message">{{ settings.databaseMessage?.text || '' }}</div>
            </section>
            <section class="maintenance-column">
              <header class="maintenance-head"><div><h2>Eh 数据</h2><span>本子索引、资料包与访问凭据</span></div></header>
              <div class="maintenance-actions"><button class="maintenance-button" @click="cookieModalVisible = true">Cookie 设置</button><button class="maintenance-button eh-download-trigger" :class="{ 'is-downloading': download.queue.length > 0 }" :aria-busy="download.downloading" @click="navigation.showPage('page-eh-download')">作品下载<span v-if="download.queue.length" class="eh-download-trigger-dot" aria-hidden="true"></span></button></div>
            </section>
          </article>
        </section>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="activeDrawer" class="settings-drawer-layer" @click.self="closeDrawer"><aside class="settings-drawer" role="dialog" aria-modal="true" :aria-label="drawerTitle"><header class="settings-drawer-head"><div><span>设置</span><h2>{{ drawerTitle }}</h2></div><button class="drawer-close" aria-label="关闭" @click="closeDrawer">×</button></header><div class="settings-drawer-body">
        <template v-if="activeDrawer === 'media'"><section v-for="group in groups" v-show="groupItems(group.key).length" :key="group.key" class="drawer-result-group"><header><h3>{{ group.title }}</h3><span>{{ groupItems(group.key).length }} 项</span><button v-if="group.key === 'changed_works'" class="btn-primary compact" @click="settings.applyLibraryUpdates">全部更新</button><button v-if="group.key === 'new_complete_works'" class="btn-primary compact" @click="settings.importConsoleWorks">导入新作品</button></header><div v-for="(item, index) in groupItems(group.key)" :key="item.folder_path" class="drawer-result-item"><div><strong>{{ item.title }}</strong><span>{{ item.status }}</span><small v-if="item.new_episode_numbers?.length">{{ item.new_episode_numbers.map(number => `#${number}`).join('、') }}</small></div><button v-if="group.key === 'new_episode_works'" class="text-action" @click="continueArchive(group.key, index)">继续建档</button><button v-else-if="group.key === 'attention_works' && isMissingDirectoryItem(item)" class="text-action danger" @click="settings.deleteMissingDatabaseRecord(index)">删除记录</button><button v-else class="text-action" @click="settings.openConsoleFolder(group.key, index)">打开文件夹</button></div></section></template>
        <template v-else-if="activeDrawer === 'eh'"><div class="drawer-summary"><i class="dashboard-status-dot warning"></i><strong>{{ ehIssueCount }} 项需要检查</strong></div><div v-for="(issue, index) in eh.ehScanErrors" :key="issue.folder_path" class="drawer-result-item"><div><strong>{{ issue.title }}</strong><span>{{ issue.reason }}</span></div><button class="text-action" @click="eh.openScanIssue(index)">打开文件夹</button></div></template>
        <template v-else><div v-if="!settings.duplicates.length" class="drawer-empty">{{ settings.duplicateMessage?.text || '尚未进行重复作品检查' }}</div><div v-for="(group, groupIndex) in settings.duplicates" :key="groupIndex" class="duplicate-group"><div class="duplicate-group-title">重复组 {{ groupIndex + 1 }}</div><div v-for="item in group.items" :key="item.folder_path" class="duplicate-item"><strong>{{ item.title }}</strong><span>{{ item.source }} / {{ item.video_count }} 集 / {{ duplicateSize(item.total_size) }}</span><small>{{ item.folder_path }}</small></div></div></template>
      </div></aside></div>
      <div class="modal-mask" :class="{ active: cookieModalVisible }" @click.self="cookieModalVisible = false"><div class="modal eh-cookie-modal" role="dialog" aria-modal="true" aria-label="Eh Cookie 设置"><div class="modal-title">Eh Cookie 设置</div><div class="modal-copy">用于请求作品元数据，仅保存在软件本体旁的 Eh 数据库中。</div><div class="eh-cookie-fields"><label><span>ipb_member_id</span><input v-model="eh.ehMemberId" class="s-input" type="password" autocomplete="off"></label><label><span>ipb_pass_hash</span><input v-model="eh.ehPassHash" class="s-input" type="password" autocomplete="off"></label><label><span>igneous</span><input v-model="eh.ehIgneous" class="s-input" type="password" autocomplete="off"></label></div><div v-if="eh.ehCredentialsMessage" class="settings-msg" :class="eh.ehCredentialsMessage.kind">{{ eh.ehCredentialsMessage.text }}</div><div class="modal-actions"><button class="btn-secondary" @click="cookieModalVisible = false">取消</button><button class="btn-primary" :disabled="eh.ehCredentialsSaving" @click="saveEhCookies">保存</button></div></div></div>
    </Teleport>
  </div>
</template>
