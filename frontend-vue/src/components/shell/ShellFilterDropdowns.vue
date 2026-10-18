<script setup lang="ts">
import { computed } from 'vue';
import { type DropdownPosition, type FilterKey, useLibraryStore } from '../../stores/library';
import { type EhFilterKey, useEhLibraryStore } from '../../stores/ehLibrary';

defineProps<{ ehDropdownPosition: DropdownPosition }>();

const library = useLibraryStore();
const ehLibrary = useEhLibraryStore();

const filterLabels: Record<FilterKey, string> = {
  year: '发行时间',
  studio: '制作商',
  story: '剧情',
  attr: '属性',
  scene: '场景',
};
const ehFilterLabels: Record<EhFilterKey, string> = {
  category: '分类',
  artist: '画师',
  group: '社团',
  tag: 'Tag',
};
const dropdownStyle = computed(() => ({
  top: `${library.dropdownPosition.top}px`,
  left: `${library.dropdownPosition.left}px`,
  width: `${library.dropdownPosition.width}px`,
  transform: 'translateX(-50%)',
}));
const genericOptions = computed(() =>
  library.openDropdown && library.openDropdown !== 'year'
    ? library.filterOptions(library.openDropdown)
    : [],
);
const activeFilterCount = computed(() =>
  library.openDropdown
    ? Object.keys(library.activeFilters[library.openDropdown] || {}).length
    : 0,
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="library.openDropdown"
      id="filterDropdown"
      class="filter-dd"
      :class="{ 'year-dd': library.openDropdown === 'year' }"
      :data-key="library.openDropdown"
      :style="dropdownStyle"
      @click.stop
    >
      <div class="filter-dd-head">
        <div><strong>{{ filterLabels[library.openDropdown] }}</strong></div>
        <span v-if="activeFilterCount" class="filter-dd-count">已选 {{ activeFilterCount }}</span>
      </div>
      <template v-if="library.openDropdown === 'year'">
        <div class="year-picker">
          <div class="year-list">
            <button
              v-for="year in library.years"
              :key="year"
              class="year-option"
              :class="{ current: library.dropdownYear === year, selected: library.isSelected('year', String(year)) }"
              @click="library.toggleWholeYear(year)"
            >
              <span>{{ year }}</span><span class="year-check fluent-icon">{{ library.isSelected('year', String(year)) ? '\uE73E' : '\uE76C' }}</span>
            </button>
          </div>
          <div class="month-panel">
            <div class="month-panel-title"><strong>{{ library.dropdownYear }}</strong><span>按月份细分</span></div>
            <div class="month-grid">
              <button
                v-for="month in 12"
                :key="month"
                class="month-cell"
                :class="{ selected: library.isSelected('year', `${library.dropdownYear}-${String(month).padStart(2, '0')}`) }"
                @click="library.toggleYearMonth(`${library.dropdownYear}-${String(month).padStart(2, '0')}`)"
              >
                {{ String(month).padStart(2, '0') }}月
              </button>
            </div>
          </div>
        </div>
        <div class="dd-actions">
          <button class="dd-reset" :disabled="!activeFilterCount" @click="library.clearFilter('year')">重置</button>
          <button class="dd-confirm" @click="library.closeDropdown">完成</button>
        </div>
      </template>
      <template v-else>
        <div class="dd-body" :class="library.openDropdown === 'studio' ? 'col' : 'row'">
          <button
            v-for="option in genericOptions"
            :key="option.value"
            class="dd-tag"
            :class="{ selected: library.isSelected(library.openDropdown!, option.value) }"
            @click="library.toggleFilter(library.openDropdown!, option.value)"
          >
            <span>{{ option.label }}</span><span v-if="library.isSelected(library.openDropdown!, option.value)" class="dd-tag-check fluent-icon">&#xE73E;</span>
          </button>
        </div>
        <div class="dd-actions">
          <button class="dd-reset" :disabled="!activeFilterCount" @click="library.clearFilter(library.openDropdown!)">重置</button>
          <button class="dd-confirm" @click="library.closeDropdown">完成</button>
        </div>
      </template>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="ehLibrary.openDropdown"
      class="filter-dd"
      :style="{
        top: `${ehDropdownPosition.top}px`,
        left: `${ehDropdownPosition.left}px`,
        width: `${ehDropdownPosition.width}px`,
        transform: 'translateX(-50%)',
      }"
      @click.stop
    >
      <div class="filter-dd-head">
        <strong>{{ ehFilterLabels[ehLibrary.openDropdown] }}</strong>
        <span v-if="ehLibrary.activeFilters[ehLibrary.openDropdown]?.length" class="filter-dd-count">
          已选 {{ ehLibrary.activeFilters[ehLibrary.openDropdown].length }}
        </span>
      </div>
      <div class="dd-body" :class="ehLibrary.openDropdown === 'category' ? 'col' : 'row'">
        <button
          v-for="option in ehLibrary.options(ehLibrary.openDropdown)"
          :key="option"
          class="dd-tag"
          :class="{ selected: ehLibrary.isSelected(ehLibrary.openDropdown, option) }"
          @click="ehLibrary.toggleFilter(ehLibrary.openDropdown!, option)"
        >
          {{ ehLibrary.optionLabel(ehLibrary.openDropdown, option) }}
        </button>
      </div>
      <div class="dd-actions">
        <button
          class="dd-reset"
          :disabled="!ehLibrary.activeFilters[ehLibrary.openDropdown]?.length"
          @click="ehLibrary.clearFilter(ehLibrary.openDropdown!)"
        >重置</button>
        <button class="dd-confirm" @click="ehLibrary.closeDropdown">完成</button>
      </div>
    </div>
  </Teleport>
</template>
