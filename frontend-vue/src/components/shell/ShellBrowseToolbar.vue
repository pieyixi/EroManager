<script setup lang="ts">
import type { ShellBrowseControls } from '../../features/shell/useShellBrowseControls';

const props = defineProps<{ controls: ShellBrowseControls; pageTitle: string }>();
const { library, ehLibrary, isMediaLibrary, isEh, isBrowsePage, ehFilterLabels,
  bindSearchElement, bindSearchContainer, searchExpanded, shellSearch, showShellClear,
  openFilter, openEhFilter, clearSearch, expandSearch, collapseSearch } = props.controls;
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
    <template v-else>
      <span class="titlebar-page-name">{{ pageTitle }}</span>
    </template>
  </div>

  <span v-if="isBrowsePage" class="titlebar-result-count" id="resultCount"
    >{{
      isEh ? ehLibrary.filteredGalleries.length : library.filteredWorks.length
    }}
    部</span
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
        isEh
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
      v-if="isBrowsePage"
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
