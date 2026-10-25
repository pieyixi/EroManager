<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import AccountSettings from '../components/settings/AccountSettings.vue';
import SettingsDataPanel from '../components/settings/SettingsDataPanel.vue';
import SettingRow from '../components/settings/SettingRow.vue';
import AppDialog from '../components/shared/AppDialog.vue';
import SettingsSelect from '../components/settings/SettingsSelect.vue';
import SettingsProfile from '../components/settings/SettingsProfile.vue';
import { usePreferencesStore } from '../stores/preferences';
import { useNavigationStore } from '../stores/navigation';
import { useUiStore } from '../stores/ui';
import type { UserPreferences } from '../api/contracts/preferences';
import { playerLoopOptions } from '../features/player/model';

const preferences = usePreferencesStore();
const navigation = useNavigationStore();
const ui = useUiStore();
const dataPanel = ref<InstanceType<typeof SettingsDataPanel> | null>(null);
const scrollArea = ref<HTMLElement | null>(null);
const settingsFlow = ref<HTMLElement | null>(null);
const activeCategory = ref('general');
const anchorRequest = ref<string | null>(null);
const categories = [{ key: 'general', label: '常规' }, { key: 'account', label: '账号' }, { key: 'playback', label: '播放' },
  { key: 'reading', label: '阅读' }, { key: 'downloads', label: '下载' },
  { key: 'data', label: '数据' }, { key: 'shortcuts', label: '快捷键' }, { key: 'about', label: '关于' }];
const sections = new Map<string, HTMLElement>();
const shortcutsVisible = ref(false);
const values = computed(() => preferences.values);
function bindSection(key: string, element: unknown): void {
  if (element instanceof HTMLElement) sections.set(key, element); else sections.delete(key);
}
function trackScroll(): void {
  const area = scrollArea.value;
  if (!area || navigation.activePage !== 'page-settings') return;
  if (anchorRequest.value) return;
  let key = 'general';
  for (const category of categories) {
    const section = sections.get(category.key);
    if (section && section.getBoundingClientRect().top <= area.getBoundingClientRect().top + 125) key = category.key;
  }
  if (area.scrollTop > 0 && area.scrollTop + area.clientHeight >= area.scrollHeight - 4) key = 'about';
  activeCategory.value = key;
}
function jump(key: string): void {
  const area = scrollArea.value, section = sections.get(key);
  if (!area || !section) return;
  anchorRequest.value = key;
  activeCategory.value = key;
  area.scrollTo({ top: key === 'general' ? 0 : area.scrollTop + section.getBoundingClientRect().top - area.getBoundingClientRect().top - 24, behavior: 'smooth' });
}
function change(key: keyof UserPreferences, event: Event): void {
  const target = event.target as HTMLInputElement;
  const value = target.type === 'checkbox' ? target.checked : ['range', 'number'].includes(target.type) ? Number(target.value) : target.value;
  preferences.update({ [key]: value } as Partial<UserPreferences>);
}
function changeTheme(value: string | number, origin: { x: number; y: number }): void {
  const theme = value as 'light' | 'dark' | 'system';
  preferences.update({ theme });
  ui.setTheme(theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme, origin, 'soft');
}
function selectPreference(key: keyof UserPreferences, value: string | number): void {
  preferences.update({ [key]: value } as Partial<UserPreferences>);
}
async function resetPreferences(): Promise<void> {
  if (await navigation.askConfirm('恢复默认偏好', '仅重置外观、播放、阅读与下载提示偏好。收藏、作品历史、目录和访问凭据都会保留。', '恢复默认')) await preferences.reset();
}
watch(() => navigation.activePage, async page => { anchorRequest.value = null; if (page === 'page-settings') { await nextTick(); trackScroll(); } else shortcutsVisible.value = false; });
onBeforeUnmount(() => sections.clear());
</script>

<template>
  <div class="page settings-page" :class="{ active: navigation.activePage === 'page-settings' }" id="page-settings">
    <AppDialog :open="shortcutsVisible" title="快捷键使用说明" @close="shortcutsVisible = false"><div class="settings-shortcuts">
              <div><h3>播放</h3><dl><div><dt>播放 / 暂停</dt><dd><kbd>空格</kbd></dd></div><div><dt>快退 / 快进</dt><dd><kbd>←</kbd><kbd>→</kbd></dd></div><div><dt>调节音量</dt><dd><kbd>↑</kbd><kbd>↓</kbd></dd></div><div><dt>上一帧 / 下一帧</dt><dd><kbd>,</kbd><kbd>.</kbd></dd></div><div><dt>静音 / 全屏</dt><dd><kbd>M</kbd><kbd>F</kbd></dd></div></dl></div>
              <div><h3>阅读</h3><dl><div><dt>翻页（跟随阅读方向）</dt><dd><kbd>←</kbd><kbd>→</kbd></dd></div><div><dt>放大 / 缩小</dt><dd><kbd>↑</kbd><kbd>↓</kbd></dd></div><div><dt>退出全屏 / 收起工具 / 返回</dt><dd><kbd>Esc</kbd></dd></div><div><dt>打开阅读工具</dt><dd><kbd>右键</kbd></dd></div></dl><p>快捷键目前使用固定映射。</p></div>
            </div></AppDialog>
    <div class="settings-layout">
      <div ref="scrollArea" class="settings-scroll" @scroll.passive="trackScroll" @wheel.passive="anchorRequest = null" @pointerdown="anchorRequest = null" @keydown="event => { if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) anchorRequest = null; }">
        <div class="settings-content">
          <SettingsProfile :flow="settingsFlow" />
          <div ref="settingsFlow" class="settings-sections">
          <div v-if="preferences.error" class="preference-error" role="alert"><span>{{ preferences.error }}</span><button class="btn-secondary" :disabled="preferences.saving || preferences.loading" @click="preferences.loaded ? preferences.save() : preferences.load()">重试</button></div>
          <section :ref="element => bindSection('general', element)" class="settings-group" data-settings-group="general">
            <header class="settings-group-head"><h2>常规</h2><span>外观与浏览习惯</span></header>
            <div class="settings-card">
              <SettingRow title="外观" description=""><SettingsSelect label="外观" :model-value="values.theme || ui.theme" :options="[{ value: 'light', label: '浅色模式' }, { value: 'dark', label: '深色模式' }, { value: 'system', label: '跟随系统' }]" @change="changeTheme" /></SettingRow>
              <SettingRow title="启动页面" description="下次打开软件时进入的页面。"><SettingsSelect label="启动页面" :model-value="values.startup_page" :options="[{ value: 'home', label: '首页' }, { value: 'media-library', label: '里番' }, { value: 'eh-library', label: '本子' }]" :disabled="!preferences.loaded" @change="value => selectPreference('startup_page', value)" /></SettingRow>
              <SettingRow title="里番排序" description="与里番列表共用排序，切换资料库保留筛选与分页。"><SettingsSelect label="里番排序" :model-value="values.media_sort" :options="[{ value: 'time-desc', label: '时间 · 新到旧' }, { value: 'time-asc', label: '时间 · 旧到新' }, { value: 'name-asc', label: '名称 · 升序' }, { value: 'name-desc', label: '名称 · 降序' }]" :disabled="!preferences.loaded" @change="value => selectPreference('media_sort', value)" /></SettingRow>
              <SettingRow title="本子排序" description="入库按本地加入时间；时间按远程发布时间。"><SettingsSelect label="本子排序" :model-value="values.book_sort" :options="[{ value: 'added-desc', label: '入库 · 新到旧' }, { value: 'added-asc', label: '入库 · 旧到新' }, { value: 'time-desc', label: '时间 · 新到旧' }, { value: 'time-asc', label: '时间 · 旧到新' }, { value: 'name-asc', label: '名称 · 升序' }, { value: 'name-desc', label: '名称 · 降序' }]" :disabled="!preferences.loaded" @change="value => selectPreference('book_sort', value)" /></SettingRow>
              <SettingRow title="关闭主界面时"><div class="settings-close-choices"><label><input type="radio" name="settings-close-action" value="tray" :checked="values.close_action === 'tray'" :disabled="!preferences.loaded" @change="preferences.update({ close_action: 'tray' })">最小化到系统托盘</label><label><input type="radio" name="settings-close-action" value="exit" :checked="values.close_action === 'exit'" :disabled="!preferences.loaded" @change="preferences.update({ close_action: 'exit' })">退出应用</label><label><input type="checkbox" :checked="values.close_prompt" :disabled="!preferences.loaded" @change="change('close_prompt', $event)">关闭时提示</label></div></SettingRow>
            </div>
          </section>
          <section :ref="element => bindSection('account', element)" class="settings-group" data-settings-group="account"><header class="settings-group-head"><h2>账号</h2></header><AccountSettings /></section>
          <section :ref="element => bindSection('playback', element)" class="settings-group" data-settings-group="playback">
            <header class="settings-group-head"><h2>播放</h2><span>默认播放方式</span></header>
            <div class="settings-card">
              <SettingRow title="默认音量"><div class="setting-range"><input aria-label="默认音量" type="range" min="0" max="100" :value="values.player_volume" :disabled="!preferences.loaded" @input="change('player_volume', $event)"><output>{{ values.player_volume }}%</output></div></SettingRow>
              <SettingRow title="默认倍速"><SettingsSelect label="默认倍速" :model-value="values.player_speed" :options="[0.5,0.75,1,1.25,1.5,1.75,2,3,4].map(value => ({ value, label: `${value}×` }))" :disabled="!preferences.loaded" @change="value => selectPreference('player_speed', value)" /></SettingRow>
              <SettingRow title="画面适应"><SettingsSelect label="画面适应" :model-value="values.player_fit" :options="[{ value: 'contain', label: '适应窗口' }, { value: 'fill', label: '填充窗口' }, { value: 'original', label: '原始尺寸' }]" :disabled="!preferences.loaded" @change="value => selectPreference('player_fit', value)" /></SettingRow>
              <SettingRow title="循环方式" :description="values.player_loop === 'random' ? '按集播完整部作品，再随机切换另一部，从第一集开始。' : ''"><SettingsSelect label="循环方式" :model-value="values.player_loop" :options="playerLoopOptions" :disabled="!preferences.loaded" @change="value => selectPreference('player_loop', value)" /></SettingRow>
              <SettingRow title="自动下一集" :description="values.player_loop === 'random' ? '随机播放期间持续连播。' : ''"><input class="setting-switch" type="checkbox" role="switch" aria-label="自动下一集" :checked="values.player_auto_next || values.player_loop === 'random'" :disabled="!preferences.loaded || values.player_loop === 'random'" @change="change('player_auto_next', $event)"></SettingRow>
              <SettingRow title="记忆播放进度"><input class="setting-switch" type="checkbox" role="switch" aria-label="记忆播放进度" :checked="values.remember_playback" :disabled="!preferences.loaded" @change="change('remember_playback', $event)"></SettingRow>
            </div>
          </section>
          <section :ref="element => bindSection('reading', element)" class="settings-group" data-settings-group="reading">
            <header class="settings-group-head"><h2>阅读</h2><span>默认页面呈现</span></header>
            <div class="settings-card">
              <SettingRow title="页面模式"><SettingsSelect label="页面模式" :model-value="values.reader_mode" :options="[{ value: 'double', label: '双页' }, { value: 'single', label: '单页' }]" :disabled="!preferences.loaded" @change="value => selectPreference('reader_mode', value)" /></SettingRow>
              <SettingRow title="阅读方向"><SettingsSelect label="阅读方向" :model-value="values.reader_direction" :options="[{ value: 'rtl', label: '从右向左' }, { value: 'ltr', label: '从左向右' }]" :disabled="!preferences.loaded" @change="value => selectPreference('reader_direction', value)" /></SettingRow>
              <SettingRow title="默认缩放"><SettingsSelect label="默认缩放" :model-value="values.reader_zoom" :options="[50,75,100,125,150,160].map(value => ({ value, label: value === 100 ? '适应屏幕（100%）' : `${value}%` }))" :disabled="!preferences.loaded" @change="value => selectPreference('reader_zoom', value)" /></SettingRow>
              <SettingRow title="滚轮翻页"><input class="setting-switch" type="checkbox" role="switch" aria-label="滚轮翻页" :checked="values.reader_wheel" :disabled="!preferences.loaded" @change="change('reader_wheel', $event)"></SettingRow>
              <SettingRow title="记忆阅读位置"><input class="setting-switch" type="checkbox" role="switch" aria-label="记忆阅读位置" :checked="values.remember_reading" :disabled="!preferences.loaded" @change="change('remember_reading', $event)"></SettingRow>
            </div>
          </section>
          <section :ref="element => bindSection('downloads', element)" class="settings-group" data-settings-group="downloads">
            <header class="settings-group-head"><h2>下载</h2><span>访问凭据与完成提示</span></header>
            <div class="settings-card">
              <SettingRow title=""><button class="btn-secondary" @click="dataPanel?.openCredentials()">Cookie 设置</button></SettingRow>
              <SettingRow title="下载完成与失败提示"><input class="setting-switch" type="checkbox" role="switch" aria-label="下载完成与失败提示" :checked="values.download_notify" :disabled="!preferences.loaded" @change="change('download_notify', $event)"></SettingRow>
              <SettingRow title=""><SettingsSelect source="Ehentai" prefix="同时下载" label="Ehentai 同时下载图片数" :model-value="values.eh_parallel_images" :options="[1,2,3,4,5].map(value => ({ value, label: `${value}张` }))" :disabled="!preferences.loaded" @change="value => selectPreference('eh_parallel_images', value)" /></SettingRow>
              <SettingRow title=""><SettingsSelect source="Hitomi" prefix="同时下载" label="Hitomi 同时下载图片数" :model-value="values.hitomi_parallel_images" :options="[1,2,3,4,5].map(value => ({ value, label: `${value}张` }))" :disabled="!preferences.loaded" @change="value => selectPreference('hitomi_parallel_images', value)" /></SettingRow>
            </div>
          </section>
          <section :ref="element => bindSection('data', element)" class="settings-group" data-settings-group="data">
            <header class="settings-group-head"><h2>数据</h2><span>目录连接与维护</span></header>
            <SettingsDataPanel ref="dataPanel" />
          </section>
          <section :ref="element => bindSection('shortcuts', element)" class="settings-group" data-settings-group="shortcuts">
            <header class="settings-group-head"><h2>快捷键</h2><span>现有按键说明</span></header>
            <div class="settings-card"><SettingRow title=""><button class="btn-secondary" @click="shortcutsVisible = true">快捷键使用说明</button></SettingRow></div>
          </section>
          <section :ref="element => bindSection('about', element)" class="settings-group" data-settings-group="about">
            <header class="settings-group-head"><h2>关于</h2><span>裏界箱庭</span></header>
            <div class="settings-card">
              <SettingRow title="版本"><span>{{ preferences.info?.version || '正在读取' }}</span></SettingRow>
              <SettingRow title="程序位置"><span class="settings-path">{{ preferences.info?.app_directory || '正在读取' }}</span></SettingRow>
              <SettingRow title="数据库位置"><span class="settings-path">{{ preferences.info?.database_directory || '正在读取' }}</span></SettingRow>
              <SettingRow title=""><button class="btn-secondary" :disabled="preferences.loading || preferences.saving" @click="resetPreferences">恢复默认</button></SettingRow>
            </div>
          </section>
          </div>
        </div>
      </div>
      <aside class="settings-category-rail" aria-label="设置分类">
        <nav><button v-for="category in categories" :key="category.key" :class="{ active: activeCategory === category.key }" :aria-current="activeCategory === category.key ? 'location' : undefined" @click="jump(category.key)">{{ category.label }}</button></nav>
      </aside>
    </div>
  </div>
</template>
