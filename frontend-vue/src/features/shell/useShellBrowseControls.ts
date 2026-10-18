import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { type DropdownPosition, type FilterKey, useLibraryStore } from '../../stores/library';
import { type EhFilterKey, useEhLibraryStore } from '../../stores/ehLibrary';
import { useNavigationStore } from '../../stores/navigation';

/** 壳层搜索、筛选与外点收起的完整交互；DOM 测量留在 UI 层，不进入 Store。 */
export function useShellBrowseControls() {
  const navigation = useNavigationStore();
  const library = useLibraryStore();
  const ehLibrary = useEhLibraryStore();
  const searchElement = ref<HTMLInputElement | null>(null);
  const searchContainer = ref<HTMLElement | null>(null);
  const searchExpanded = ref(false);
  const ehDropdownPosition = ref({ top: 0, left: 0, width: 310 });
  const ehFilterLabels: Record<EhFilterKey, string> = {
    category: "分类",
    artist: "画师",
    group: "社团",
    tag: "Tag",
  };
  const isMediaLibrary = computed(() => navigation.activePage === "page-media-library");
  const isEh = computed(() => navigation.activePage === "page-eh-library");
  const isBrowsePage = computed(() => isMediaLibrary.value || isEh.value);

  const shellSearch = computed({
    get: () => (isEh.value ? ehLibrary.search : library.search),
    set: (value: string) => {
      if (isEh.value) {
        ehLibrary.search = value;
        ehLibrary.currentPage = 1;
      } else {
        library.search = value;
        library.currentPage = 1;
      }
    },
  });
  const showShellClear = computed(() =>
    isEh.value ? ehLibrary.showClearButton : library.showClearButton,
  );

  function openFilter(key: FilterKey, event: MouseEvent): void {
    event.stopPropagation();
    collapseSearch();
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    const width = Math.min(key === 'year' ? 410 : key === 'studio' ? 180 : 480, window.innerWidth - 20);
    const half = width / 2;
    const shellInset = 64 + 8;
    const left = Math.max(shellInset + half, Math.min(window.innerWidth - 8 - half, rect.left + rect.width / 2));
    const position: DropdownPosition = { top: rect.bottom + 2, left, width };
    library.toggleDropdown(key, position);
  }

  function clearSearch(): void {
    if (isEh.value) ehLibrary.clearSearchAndFilters();
    else library.clearSearchAndFilters();
  }

  function openEhFilter(key: EhFilterKey, event: MouseEvent): void {
    event.stopPropagation();
    collapseSearch();
    library.closeDropdown();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const width = key === "tag" ? 390 : 310;
    const left = Math.max(
      width / 2 + 8,
      Math.min(window.innerWidth - width / 2 - 8, rect.left + rect.width / 2),
    );
    ehDropdownPosition.value = { top: rect.bottom + 8, left, width };
    ehLibrary.toggleDropdown(key);
  }

  function expandSearch(): void {
    if (searchExpanded.value) return;
    searchExpanded.value = true;
    library.closeDropdown();
    ehLibrary.closeDropdown();
  }

  function collapseSearch(): void {
    if (!searchExpanded.value) return;
    searchExpanded.value = false;
    if (document.activeElement === searchElement.value)
      searchElement.value?.blur();
  }
  function handleDocumentClick(): void {
    library.closeDropdown();
    ehLibrary.closeDropdown();
  }

  function handleDocumentPointerDown(event: PointerEvent): void {
    if (
      searchExpanded.value &&
      !searchContainer.value?.contains(event.target as Node)
    )
      collapseSearch();
  }

  watch(
    () => navigation.activePage,
    () => {
      collapseSearch();
      library.closeDropdown();
      ehLibrary.closeDropdown();
      navigation.closeContextMenu();
    },
  );
  onMounted(() => {
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
  });
  onBeforeUnmount(() => {
    document.removeEventListener('click', handleDocumentClick);
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  });
  return {
    library, ehLibrary, isMediaLibrary, isEh, isBrowsePage, ehFilterLabels,
    bindSearchElement: (element: unknown) => { searchElement.value = element as HTMLInputElement | null; },
    bindSearchContainer: (element: unknown) => { searchContainer.value = element as HTMLElement | null; },
    searchExpanded, ehDropdownPosition, shellSearch, showShellClear,
    openFilter, openEhFilter, clearSearch, expandSearch, collapseSearch,
    closeMediaDropdown: () => library.closeDropdown(),
  };
}
export type ShellBrowseControls = ReturnType<typeof useShellBrowseControls>;
