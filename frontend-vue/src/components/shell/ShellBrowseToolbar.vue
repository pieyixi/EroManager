<script setup lang="ts">
import type { ShellBrowseControls } from '../../features/shell/useShellBrowseControls';

const props = defineProps<{ controls: ShellBrowseControls; pageTitle: string }>();
const { library, ehLibrary, avLibrary, isMediaLibrary, isEh, isAv, isBrowsePage, ehFilterLabels, avFilterLabels,
  bindSearchElement, bindSearchContainer, searchExpanded, shellSearch, showShellClear,
  openFilter, openEhFilter, openAvFilter, toggleAvMode, clearSearch, expandSearch, collapseSearch } = props.controls;
</script>

<template>
  <div class="titlebar-navigation" id="filterRow">
    <template v-if="isMediaLibrary">
      <button
        class="top-filter-tab"
        :class="{ active: library.isFilterActive('year') }"
        @click="openFilter('year', $event)"
      >
        年份<span class="top-filter-arrow">⌄</span>
      </button>
      <button
        class="top-filter-tab"
        :class="{ active: library.isFilterActive('studio') }"
        @click="openFilter('studio', $event)"
      >
        制作商<span class="top-filter-arrow">⌄</span>
      </button>
      <button
        class="top-filter-tab"
        :class="{ active: library.isFilterActive('story') }"
        @click="openFilter('story', $event)"
      >
        剧情<span class="top-filter-arrow">⌄</span>
      </button>
      <button
        class="top-filter-tab"
        :class="{ active: library.isFilterActive('attr') }"
        @click="openFilter('attr', $event)"
      >
        属性<span class="top-filter-arrow">⌄</span>
      </button>
      <button
        class="top-filter-tab"
        :class="{ active: library.isFilterActive('scene') }"
        @click="openFilter('scene', $event)"
      >
        场景<span class="top-filter-arrow">⌄</span>
      </button>
      <button
        class="top-sort-btn"
        id="sortTimeBtn"
        :class="{ active: library.currentSort.startsWith('time') }"
        title="切换时间顺序"
        @click="library.toggleTimeSort"
      >
        时间<span class="fluent-icon">{{
          library.currentSort === "time-desc" ? "\uE74A" : "\uE74B"
        }}</span>
      </button>
      <button
        class="top-sort-btn"
        id="sortNameBtn"
        :class="{ active: library.currentSort.startsWith('name') }"
        title="切换名称顺序"
        @click="library.toggleNameSort"
      >
        名称<span class="fluent-icon">{{
          library.currentSort === "name-desc" ? "\uE74A" : "\uE74B"
        }}</span>
      </button>
    </template>
    <template v-else-if="isEh">
      <button
        v-for="(label, key) in ehFilterLabels"
        :key="key"
        class="top-filter-tab"
        :class="{ active: ehLibrary.isFilterActive(key) }"
        @click="openEhFilter(key, $event)"
      >
        {{ label }}<span class="top-filter-arrow">⌄</span>
      </button>
      <button
        class="top-sort-btn"
        :class="{ active: ehLibrary.currentSort.startsWith('added') }"
        title="切换入库顺序"
        @click="ehLibrary.toggleAddedSort"
      >
        入库<span class="fluent-icon">{{
          ehLibrary.currentSort === "added-desc" ? "\uE74A" : "\uE74B"
        }}</span>
      </button>
      <button
        class="top-sort-btn"
        :class="{ active: ehLibrary.currentSort.startsWith('name') }"
        @click="ehLibrary.toggleNameSort"
      >
        名称<span class="fluent-icon">{{
          ehLibrary.currentSort === "name-desc" ? "\uE74A" : "\uE74B"
        }}</span>
      </button>
      <button
        class="top-sort-btn"
        :class="{ active: ehLibrary.currentSort.startsWith('time') }"
        @click="ehLibrary.toggleTimeSort"
      >
        时间<span class="fluent-icon">{{
          ehLibrary.currentSort === "time-desc" ? "\uE74A" : "\uE74B"
        }}</span>
      </button>
    </template>
    <template v-else-if="isAv">
      <button class="top-filter-tab av-view-toggle" type="button" aria-label="切换番号／女优显示"
        :aria-pressed="avLibrary.mode === 'actress'" :title="avLibrary.mode === 'code' ? '切换为女优照片' : '切换为番号封面'"
        @click="toggleAvMode">
        {{ avLibrary.mode === 'code' ? '番号' : '女优' }}
        <svg class="av-mode-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h10l-2.5-2.5M13 11H3l2.5 2.5"/></svg>
      </button>
      <button v-for="(label, key) in avFilterLabels" :key="key" class="top-filter-tab"
        :class="{ active: avLibrary.isFilterActive(key) }" @click="openAvFilter(key, $event)">
        {{ key === 'year' ? '年份' : label }}<span class="top-filter-arrow">⌄</span>
      </button>
      <button class="top-sort-btn" :class="{ active: avLibrary.currentSort.startsWith('time') }" title="切换时间顺序" @click="avLibrary.toggleTimeSort">
        时间<span class="fluent-icon">{{ avLibrary.currentSort === 'time-desc' ? '\uE74A' : '\uE74B' }}</span>
      </button>
      <button class="top-sort-btn" :class="{ active: avLibrary.currentSort.startsWith('name') }" title="切换名称顺序" @click="avLibrary.toggleNameSort">
        名称<span class="fluent-icon">{{ avLibrary.currentSort === 'name-desc' ? '\uE74A' : '\uE74B' }}</span>
      </button>
    </template>
    <template v-else>
      <span class="titlebar-page-name">{{ pageTitle }}</span>
    </template>
  </div>

  <span v-if="isBrowsePage" class="titlebar-result-count" id="resultCount"
    >{{
      isAv ? avLibrary.totalCount : isEh ? ehLibrary.filteredGalleries.length : library.filteredWorks.length
    }}
    {{ isAv && avLibrary.mode === 'actress' ? '人' : '部' }}</span
  >
  <button
    v-if="isBrowsePage && searchExpanded"
    class="titlebar-search-dismiss"
    type="button"
    tabindex="-1"
    aria-hidden="true"
    @pointerdown.stop.prevent="collapseSearch"
  ></button>
  <div
    v-if="isBrowsePage"
    :ref="bindSearchContainer"
    class="titlebar-search"
    @pointerdown.stop
  >
    <input
      id="searchInput"
      :ref="bindSearchElement"
      v-model="shellSearch"
      type="text"
      :placeholder="
        isAv ? '搜索番号、女优、片商、系列、Tag' : isEh
          ? '搜索标题、画师、社团、Tag'
          : '搜索标题、别名、简介、制作商、Tag'
      "
      autocomplete="off"
      spellcheck="false"
      @focus="expandSearch"
      @keydown.esc="collapseSearch"
    />
    <button
      v-if="showShellClear"
      class="titlebar-search-clear"
      id="searchClear"
      @click="clearSearch"
    >
      清除
    </button>
    <button
      v-if="isBrowsePage && !isAv"
      class="titlebar-favorite fluent-icon"
      :class="{ active: isEh ? ehLibrary.favoriteMode : library.favoriteCharacterMode }"
      :disabled="isEh ? !ehLibrary.favoriteGids.length : !library.favoriteCharacters.length"
      :title="
        isEh ? (ehLibrary.favoriteGids.length ? '只看收藏作品' : '尚未收藏作品') : library.favoriteCharacters.length
          ? '只看收藏角色作品'
          : '尚未收藏角色'
      "
      @click="isEh ? ehLibrary.toggleFavoriteMode() : library.toggleFavoriteCharacterMode()"
    >
      {{ (isEh ? ehLibrary.favoriteMode : library.favoriteCharacterMode) ? "\uE735" : "\uE734" }}
    </button>
    <span class="titlebar-search-icon fluent-icon">&#xE721;</span>
  </div>
</template>

<style scoped>
.av-view-toggle { display: inline-flex; align-items: center; gap: 7px; min-width: 80px; }
.av-mode-icon { color: var(--soft); }
</style>
