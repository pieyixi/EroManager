import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, markRaw, nextTick, type EffectScope } from 'vue';

const lifecycle = vi.hoisted(() => ({ mounted: [] as Array<() => void>, unmounted: [] as Array<() => void> }));
vi.mock('vue', async importOriginal => ({
  ...await importOriginal<typeof import('vue')>(),
  onMounted: (callback: () => void) => lifecycle.mounted.push(callback),
  onBeforeUnmount: (callback: () => void) => lifecycle.unmounted.push(callback),
}));
import { useNavigationStore } from '../../stores/navigation';
import { useShellBrowseControls } from './useShellBrowseControls';

describe('shell browse controller', () => {
  let scope: EffectScope;
  let documentStub: { activeElement: unknown; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    lifecycle.mounted.length = 0; lifecycle.unmounted.length = 0;
    setActivePinia(createPinia()); scope = effectScope();
    documentStub = { activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('document', documentStub); vi.stubGlobal('window', { innerWidth: 1280 });
  });
  afterEach(() => { lifecycle.unmounted.forEach(callback => callback()); scope.stop(); vi.unstubAllGlobals(); });

  it('keeps media/book search and page resets independent', async () => {
    const controls = scope.run(useShellBrowseControls)!;
    const navigation = useNavigationStore();
    navigation.showPage('page-media-library'); await nextTick();
    controls.library.currentPage = 3; controls.ehLibrary.currentPage = 4;
    controls.shellSearch.value = 'media';
    expect(controls.library.search).toBe('media'); expect(controls.library.currentPage).toBe(1);
    expect(controls.ehLibrary.currentPage).toBe(4);
    navigation.showPage('page-eh-library'); await nextTick();
    controls.shellSearch.value = 'book';
    expect(controls.ehLibrary.search).toBe('book'); expect(controls.ehLibrary.currentPage).toBe(1);
    expect(controls.library.search).toBe('media');
    navigation.showPage('page-home'); await nextTick();
    expect(controls.isBrowsePage.value).toBe(false);
  });

  it('binds focus refs, closes filters on focus and cleans route state', async () => {
    const controls = scope.run(useShellBrowseControls)!;
    const navigation = useNavigationStore();
    const input = markRaw({ focus: vi.fn(), blur: vi.fn() });
    controls.bindSearchElement(input); documentStub.activeElement = input;
    controls.library.toggleDropdown('year', { top: 10, left: 200, width: 410 });
    controls.expandSearch();
    expect(controls.library.openDropdown).toBe(null);
    expect(controls.searchExpanded.value).toBe(true);
    navigation.contextMenu.visible = true;
    navigation.showPage('page-settings'); await nextTick();
    expect(controls.searchExpanded.value).toBe(false); expect(input.blur).toHaveBeenCalledOnce();
    expect(navigation.contextMenu.visible).toBe(false);
    controls.clearSearch(); await nextTick(); expect(input.focus).not.toHaveBeenCalled();
  });

  it.each(['page-media-library', 'page-eh-library'] as const)('clears without focusing or changing the search pose on %s', async page => {
    const controls = scope.run(useShellBrowseControls)!;
    useNavigationStore().showPage(page); await nextTick();
    const input = markRaw({ focus: vi.fn(), blur: vi.fn() });
    controls.bindSearchElement(input);
    for (const expanded of [false, true]) {
      controls.searchExpanded.value = expanded;
      controls.shellSearch.value = 'test';
      controls.clearSearch(); await nextTick();
      expect(controls.shellSearch.value).toBe('');
      expect(controls.searchExpanded.value).toBe(expanded);
      expect(input.focus).not.toHaveBeenCalled();
    }
  });

  it('preserves bounded dropdown geometry and registers matching document cleanup', () => {
    const controls = scope.run(useShellBrowseControls)!;
    lifecycle.mounted.forEach(callback => callback());
    const event = { stopPropagation: vi.fn(), currentTarget: { getBoundingClientRect: () => ({ left: 1250, width: 30, bottom: 50 }) } } as unknown as MouseEvent;
    controls.openEhFilter('tag', event);
    expect(controls.ehDropdownPosition.value).toEqual({ top: 58, left: 1077, width: 390 });
    expect(controls.ehLibrary.openDropdown).toBe('tag');
    controls.expandSearch();
    expect(controls.ehLibrary.openDropdown).toBe(null);
    controls.bindSearchContainer({ contains: () => false });
    const pointer = documentStub.addEventListener.mock.calls.find(([name]) => name === 'pointerdown')![1];
    pointer({ target: {} }); expect(controls.searchExpanded.value).toBe(false);
    lifecycle.unmounted.forEach(callback => callback()); lifecycle.unmounted.length = 0;
    expect(documentStub.removeEventListener.mock.calls).toEqual(documentStub.addEventListener.mock.calls);
  });
});
