<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useArchiveStore } from '../../stores/archive';
import { isMissingDirectoryItem, type ConsoleItem, type LibraryScan, useLibraryConsoleStore } from '../../stores/libraryConsole';
import { useEhSettingsStore } from '../../stores/ehSettings';
import { useAvDownloadStore } from '../../stores/avDownload';
import { useNavigationStore } from '../../stores/navigation';
import SettingsLibraryStats from './SettingsLibraryStats.vue';
import SettingRow from './SettingRow.vue';
import { pickDirectory } from '../../api/tauri';

const settings = useLibraryConsoleStore();
const eh = useEhSettingsStore();
const av = useAvDownloadStore();
const avPath = ref('');
watch(() => av.root, path => { avPath.value = path; }, { immediate: true });
async function chooseAvDirectory(): Promise<void> {
  try { const path = await pickDirectory(avPath.value || av.root); if (path) await av.bindRoot(path); }
  catch { av.directoryMessage = '无法选择 AV 资料目录，请重试'; av.directoryFailed = true; }
}
const archive = useArchiveStore();
const navigation = useNavigationStore();
const cookieModalVisible = ref(false);
const statsVisible = ref(false);
async function chooseBackupDirectory(): Promise<void> {
  try {
    const current = settings.backupPath.trim() || 'D:\\Ark\\backup\\ero-manager backup\\ero-data-backup.zip';
    const split = Math.max(current.lastIndexOf('\\'), current.lastIndexOf('/'));
    const directory = await pickDirectory(split >= 0 ? current.slice(0, split) : undefined);
    if (directory) settings.backupPath = `${directory.replace(/[\\/]+$/, '')}\\${split >= 0 ? current.slice(split + 1) || 'ero-data-backup.zip' : current || 'ero-data-backup.zip'}`;
  } catch { settings.databaseMessage = { kind: 'err', text: '无法选择备份目录，请重试' }; }
}
defineExpose({ openCredentials: () => { cookieModalVisible.value = true; } });
const activeDrawer = ref<'media' | 'eh' | 'duplicates' | null>(null);

type ScanGroupKey = keyof Pick<LibraryScan, 'changed_works' | 'new_episode_works' | 'new_complete_works' | 'attention_works'>;

const groups: Array<{ key: ScanGroupKey; title: string }> = [
  { key: 'changed_works', title: '已建档内容有变化' },
  { key: 'new_episode_works', title: '发现新增集数' },
  { key: 'new_complete_works', title: '可导入的新作品' },
  { key: 'attention_works', title: '需要检查' },
];

const mediaIssueCount = computed(() => groups.reduce((total, group) => total + settings.items(group.key).length, 0));
const ehIssueCount = computed(() => eh.ehScanErrors.length);
const mediaStatus = computed(() => {
  if (settings.scanning) return settings.progressText || '正在扫描媒体库';
  if (mediaIssueCount.value) return `发现 ${mediaIssueCount.value} 项变化`;
  if (settings.scan) return '上次扫描完成，未发现变化';
  return '尚未扫描';
});
const ehStatus = computed(() => {
  if (eh.ehScanning) return eh.ehProgressText || '正在扫描 本子库';
  if (ehIssueCount.value) return `发现 ${ehIssueCount.value} 项需要检查`;
  if (eh.ehScanCompleted) return '上次扫描完成，未发现问题';
  return '尚未扫描';
});
const drawerTitle = computed(() => ({ media: '媒体库扫描结果', eh: '本子库扫描结果', duplicates: '重复作品检查' }[activeDrawer.value || 'media']));

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
    if (page === 'page-settings') { void eh.loadSettings(); void av.loadSettings(); }
    else { activeDrawer.value = null; cookieModalVisible.value = false; statsVisible.value = false; }
  },
  { immediate: true },
);
</script>

<template>
  <div class="settings-data-panel">
    <SettingRow title=""><button class="btn-secondary" @click="statsVisible = true">查看数据</button></SettingRow>
    <section class="settings-data-group" aria-label="里番数据">
      <header class="settings-library-heading"><h3>里番数据</h3></header>
      <div class="settings-path-control"><input spellcheck="false" autocorrect="off" autocapitalize="off" v-model="settings.mediaPath" class="s-input" type="text" id="mediaPath" aria-label="媒体库目录"><button class="btn-secondary" @click="settings.bindMediaLibrary">更改目录</button></div>
      <div class="settings-library-state"><i class="settings-scan-dot" :class="{ scanning: settings.scanning }" aria-hidden="true"></i><span id="libraryMsg" :title="settings.scanning ? mediaStatus : settings.libraryMessage?.text || mediaStatus">{{ settings.scanning ? mediaStatus : settings.libraryMessage?.text || mediaStatus }}</span><button v-if="mediaIssueCount || settings.libraryMessage?.kind === 'err'" class="settings-scan-details" @click="openDrawer('media')">{{ mediaIssueCount ? `查看结果（${mediaIssueCount}）` : '查看详情' }}</button><button id="consoleScanButton" class="btn-primary settings-scan-button" :disabled="settings.busy" @click="settings.scanLibraryChanges">{{ settings.scanning ? '扫描中' : '扫描变化' }}</button></div>
      <div class="settings-reserved-progress" id="consoleProgress" :class="{ active: settings.progressActive }" :aria-hidden="!settings.progressActive"><div class="compact-progress-track" role="progressbar" aria-label="里番扫描进度" :aria-valuenow="settings.progressPercent" aria-valuemin="0" aria-valuemax="100"><span id="consoleProgressBar" :style="{ width: `${settings.progressPercent}%` }"></span></div><span id="consoleProgressText">{{ settings.progressText }}</span></div>
      <div class="settings-maintenance-strip"><button class="btn-secondary" :disabled="settings.busy" @click="settings.backupDatabase">备份数据库</button><button class="btn-secondary" :disabled="settings.busy" @click="settings.restoreDatabase">恢复数据库</button><button class="btn-secondary" :disabled="settings.busy" @click="settings.backupDataPackage">备份资料包</button><button class="btn-secondary" :disabled="settings.busy" @click="openDuplicateDrawer">重复检查</button></div>
      <div class="settings-path-control settings-backup-control"><input spellcheck="false" autocorrect="off" autocapitalize="off" v-model="settings.backupPath" class="s-input settings-backup-input" type="text" id="dbFilePath" aria-label="备份或恢复路径" placeholder="D:\Ark\backup\ero-manager backup\ero-data-backup.zip"><button class="btn-secondary" :disabled="settings.busy" @click="chooseBackupDirectory">更改目录</button></div>
      <div id="dbMsg" class="settings-data-feedback" :title="settings.databaseMessage?.text">{{ settings.databaseMessage?.text }}</div>
    </section>
    <section class="settings-data-group" aria-label="本子数据">
      <header class="settings-library-heading"><h3>本子数据</h3></header>
      <div class="settings-path-control"><input spellcheck="false" autocorrect="off" autocapitalize="off" v-model="eh.ehLibraryPath" class="s-input" type="text" aria-label="本子库目录"><button class="btn-secondary" @click="eh.bindLibrary">更改目录</button></div>
      <div class="settings-library-state"><i class="settings-scan-dot" :class="{ scanning: eh.ehScanning }" aria-hidden="true"></i><span :title="eh.ehScanning ? ehStatus : eh.ehLibraryMessage?.text || ehStatus">{{ eh.ehScanning ? ehStatus : eh.ehLibraryMessage?.text || ehStatus }}</span><button v-if="ehIssueCount || eh.ehLibraryMessage?.kind === 'err'" class="settings-scan-details" @click="openDrawer('eh')">{{ ehIssueCount ? `查看结果（${ehIssueCount}）` : '查看详情' }}</button><button class="btn-primary settings-scan-button" :disabled="eh.ehScanning" @click="eh.scanLibrary">{{ eh.ehScanning ? '扫描中' : '扫描变化' }}</button></div>
      <div class="settings-reserved-progress" :class="{ active: eh.ehProgressActive }" :aria-hidden="!eh.ehProgressActive"><div class="compact-progress-track" role="progressbar" aria-label="本子扫描进度" :aria-valuenow="eh.ehProgressPercent" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${eh.ehProgressPercent}%` }"></span></div><span>{{ eh.ehProgressText }}</span></div>
    </section>
    <section class="settings-data-group" aria-label="AV 数据">
      <header class="settings-library-heading"><h3>AV 数据</h3></header>
      <div class="settings-path-control"><input v-model="avPath" spellcheck="false" autocorrect="off" autocapitalize="off" class="s-input" type="text" aria-label="AV 资料目录" :disabled="av.directoryLoading || av.binding || av.running" @keydown.enter.prevent="av.bindRoot(avPath)"><button class="btn-secondary" :disabled="av.directoryLoading || av.binding || av.running" @click="chooseAvDirectory">更改目录</button></div>
      <div class="settings-library-state"><i class="settings-scan-dot" :class="{ scanning: av.binding || av.directoryLoading }" aria-hidden="true"></i><span :class="{ 'av-directory-error': av.directoryFailed }" :title="av.directoryMessage">{{ av.binding ? '正在更新目录' : av.directoryLoading ? '正在读取目录' : av.directoryMessage || (av.root ? '已连接' : '尚未设置目录') }}</span></div>
    </section>
    <SettingsLibraryStats :open="statsVisible" @close="statsVisible = false" />
    <Teleport to="body">
      <div v-if="activeDrawer" class="settings-drawer-layer" @click.self="closeDrawer"><aside class="settings-drawer" role="dialog" aria-modal="true" :aria-label="drawerTitle"><header class="settings-drawer-head"><div><span>设置</span><h2>{{ drawerTitle }}</h2></div><button class="drawer-close" aria-label="关闭" @click="closeDrawer">×</button></header><div class="settings-drawer-body">
        <template v-if="activeDrawer === 'media'"><p v-if="settings.libraryMessage?.kind === 'err'" class="drawer-scan-error">{{ settings.libraryMessage.text }}</p><section v-for="group in groups" v-show="groupItems(group.key).length" :key="group.key" class="drawer-result-group"><header><h3>{{ group.title }}</h3><span>{{ groupItems(group.key).length }} 项</span><button v-if="group.key === 'changed_works'" class="btn-primary compact" @click="settings.applyLibraryUpdates">全部更新</button><button v-if="group.key === 'new_complete_works'" class="btn-primary compact" @click="settings.importConsoleWorks">导入新作品</button></header><div v-for="(item, index) in groupItems(group.key)" :key="item.folder_path" class="drawer-result-item"><div><strong>{{ item.title }}</strong><span>{{ item.status }}</span><small v-if="item.new_episode_numbers?.length">{{ item.new_episode_numbers.map(number => `#${number}`).join('、') }}</small></div><button v-if="group.key === 'new_episode_works'" class="text-action" @click="continueArchive(group.key, index)">继续建档</button><button v-else-if="group.key === 'attention_works' && isMissingDirectoryItem(item)" class="text-action danger" @click="settings.deleteMissingDatabaseRecord(index)">删除记录</button><button v-else class="text-action" @click="settings.openConsoleFolder(group.key, index)">打开文件夹</button></div></section></template>
        <template v-else-if="activeDrawer === 'eh'"><p v-if="eh.ehLibraryMessage?.kind === 'err'" class="drawer-scan-error">{{ eh.ehLibraryMessage.text }}</p><div class="drawer-summary"><i class="dashboard-status-dot warning"></i><strong>{{ ehIssueCount }} 项需要检查</strong></div><div v-for="(issue, index) in eh.ehScanErrors" :key="issue.folder_path" class="drawer-result-item"><div><strong>{{ issue.title }}</strong><span>{{ issue.reason }}</span></div><button class="text-action" @click="eh.openScanIssue(index)">打开文件夹</button></div></template>
        <template v-else><div v-if="!settings.duplicates.length" class="drawer-empty">{{ settings.duplicateMessage?.text || '尚未进行重复作品检查' }}</div><div v-for="(group, groupIndex) in settings.duplicates" :key="groupIndex" class="duplicate-group"><div class="duplicate-group-title">重复组 {{ groupIndex + 1 }}</div><div v-for="item in group.items" :key="item.folder_path" class="duplicate-item"><strong>{{ item.title }}</strong><span>{{ item.source }} / {{ item.video_count }} 集 / {{ duplicateSize(item.total_size) }}</span><small>{{ item.folder_path }}</small></div></div></template>
      </div></aside></div>
      <div class="modal-mask" :class="{ active: cookieModalVisible }" @click.self="cookieModalVisible = false"><div class="modal eh-cookie-modal" role="dialog" aria-modal="true" aria-label="Eh Cookie 设置"><div class="modal-title">Eh Cookie 设置</div><div class="modal-copy">用于请求作品元数据，保存在程序目录 db 中的本子数据库。</div><div class="eh-cookie-fields"><label><span>ipb_member_id</span><input spellcheck="false" autocorrect="off" autocapitalize="off" v-model="eh.ehMemberId" class="s-input" type="password" autocomplete="off"></label><label><span>ipb_pass_hash</span><input spellcheck="false" autocorrect="off" autocapitalize="off" v-model="eh.ehPassHash" class="s-input" type="password" autocomplete="off"></label><label><span>igneous</span><input spellcheck="false" autocorrect="off" autocapitalize="off" v-model="eh.ehIgneous" class="s-input" type="password" autocomplete="off"></label></div><div v-if="eh.ehCredentialsMessage" class="settings-msg" :class="eh.ehCredentialsMessage.kind">{{ eh.ehCredentialsMessage.text }}</div><div class="modal-actions"><button class="btn-secondary" @click="cookieModalVisible = false">取消</button><button class="btn-primary" :disabled="eh.ehCredentialsSaving" @click="saveEhCookies">保存</button></div></div></div>
    </Teleport>
  </div>
</template>

<style scoped>
.av-directory-error { color: var(--danger); }
</style>
