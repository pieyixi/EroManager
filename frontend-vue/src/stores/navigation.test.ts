import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavigationStore, type PageId } from './navigation';
import { useLibraryStore } from './library';

vi.mock('../api/commands/library', () => ({ libraryApi: { deleteWork: vi.fn().mockResolvedValue(undefined) } }));

beforeEach(() => { setActivePinia(createPinia()); });

describe('independent home and library navigation', () => {
  it.each(['page-player', 'page-eh-reader'] as const)('preserves home detail origin through %s and resets it for a library detail', (immersive) => {
    const navigation = useNavigationStore();
    navigation.showPage('page-detail', 'page-home');
    navigation.showPage(immersive);
    navigation.showPage('page-detail');
    expect(navigation.backPage).toBe('page-home');
    navigation.showPage('page-media-library');
    navigation.showPage('page-detail');
    expect(navigation.backPage).toBe('page-media-library');
  });
  it('starts on the independent home page', () => {
    expect(useNavigationStore().activePage).toBe('page-home');
  });

  it.each([
    ['page-media-library', 'page-home'],
    ['page-eh-library', 'page-home'],
    ['page-settings', 'page-home'],
    ['page-unarchived', 'page-home'],
    ['page-eh-download', 'page-home'],
    ['page-archive', 'page-unarchived'],
  ] as Array<[PageId, PageId]>)('returns from %s to %s', (page, parent) => {
    const navigation = useNavigationStore();
    navigation.showPage(page);
    expect(navigation.backPage).toBe(parent);
  });

  it.each(['media', 'eh'] as const)('returns a %s detail to its own library, never the blank home', (source) => {
    const navigation = useNavigationStore();
    navigation.detailSource = source;
    navigation.showPage('page-detail');
    expect(navigation.backPage).toBe(source === 'media' ? 'page-media-library' : 'page-eh-library');
  });

  it.each(['page-home', 'page-media-library', 'page-eh-library', 'page-settings', 'page-unarchived', 'page-archive'] as const)(
    'returns from downloads to its actual entry %s, including repeated sidebar clicks', (origin) => {
      const navigation = useNavigationStore();
      navigation.showPage(origin);
      navigation.showPage('page-eh-download');
      navigation.showPage('page-eh-download');
      expect(navigation.backPage).toBe(origin);
      navigation.goBack();
      expect(navigation.activePage).toBe(origin);
    },
  );

  it('updates the download return target on each new visit', () => {
    const navigation = useNavigationStore();
    navigation.showPage('page-settings');
    navigation.showPage('page-eh-download');
    navigation.goBack();
    navigation.showPage('page-eh-library');
    navigation.showPage('page-eh-download');
    navigation.goBack();
    expect(navigation.activePage).toBe('page-eh-library');
  });

  it('preserves a home-origin detail when returning from downloads, but clears it for a new detail', () => {
    const navigation = useNavigationStore();
    navigation.showPage('page-detail', 'page-home');
    navigation.showPage('page-eh-download');
    navigation.goBack();
    expect(navigation.activePage).toBe('page-detail');
    expect(navigation.backPage).toBe('page-home');
    navigation.showPage('page-eh-download');
    navigation.detailSource = 'eh';
    navigation.showPage('page-detail');
    expect(navigation.backPage).toBe('page-eh-library');
  });

  it('refreshes the media library without resetting filters or opening the blank home', async () => {
    const library = useLibraryStore();
    const navigation = useNavigationStore();
    library.search = '保留搜索';
    library.currentPage = 2;
    const reload = vi.spyOn(library, 'reload').mockResolvedValue(undefined);
    navigation.contextMenu.visible = true;
    await library.refreshHome({ clearCoverCache: true });
    expect(navigation.activePage).toBe('page-media-library');
    expect(navigation.contextMenu.visible).toBe(false);
    expect(library.search).toBe('保留搜索');
    expect(library.currentPage).toBe(2);
    expect(reload).toHaveBeenCalledWith({ clearCoverCache: true });
  });

  it('opens detail tag filters in the media library', () => {
    const library = useLibraryStore();
    const navigation = useNavigationStore();
    navigation.showPage('page-detail');
    library.jumpToSingleFilter('studio', 'test-studio');
    expect(navigation.activePage).toBe('page-media-library');
    expect(library.activeFilters.studio).toEqual({ 'test-studio': true });
    expect(library.currentPage).toBe(1);
  });

  it('returns to the media library after deleting the work currently displayed', async () => {
    const library = useLibraryStore();
    const navigation = useNavigationStore();
    library.currentDetailWorkId = 7;
    navigation.showPage('page-detail');
    vi.spyOn(navigation, 'askConfirm').mockResolvedValue(true);
    vi.spyOn(library, 'initialize').mockResolvedValue(undefined);
    await library.deleteWork(7);
    expect(navigation.activePage).toBe('page-media-library');
    expect(library.currentDetailWorkId).toBeNull();
  });
});
