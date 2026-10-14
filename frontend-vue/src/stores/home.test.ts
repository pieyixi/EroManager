import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { libraryApi } from '../api/commands/library';
import { ehApi } from '../api/commands/eh';
import { mediaApi } from '../api/commands/media';
import type { WorkDetail, WorkSummary } from '../api/contracts/library';
import type { EhGallerySummary } from '../api/contracts/eh';
import { drawBusy, useHomeStore } from './home';
import { useLibraryStore } from './library';
import { useEhLibraryStore } from './ehLibrary';
import { useNavigationStore } from './navigation';

vi.mock('../api/commands/library', () => ({ libraryApi: { getWorkDetail: vi.fn() } }));
vi.mock('../api/commands/eh', () => ({ ehApi: { getPages: vi.fn() } }));
vi.mock('../api/commands/media', () => ({ mediaApi: { loadImages: vi.fn() } }));

function work(id: number): WorkSummary {
  return { id, title: `Work ${id}`, year: 2026, month: 1, studio: '', description: null, cover_path: `cover-${id}`, folder_path: '', episode_count: 5, release_dates: [], search_aliases: [], tags: [] };
}
function gallery(gid: number): EhGallerySummary {
  return { gid, token: '', source: gid < 0 ? 'hitomi' : 'eh', source_id: String(Math.abs(gid)), language: '', title: `Book ${gid}`, category: 2, artist: [], group: [], tags: [], artist_display: [], group_display: [], tags_display: [], pages: 1000, posted: '', added_at: '', cover_path: `book-${gid}`, folder_path: '' };
}
function detail(id: number): WorkDetail {
  return { work: work(id), tags: [], characters: [], episodes: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, number: i + 1, work_id: id, video_path: `video-${id}-${i}`, cover_path: `episode-${id}-${i}` })) };
}
function settle(source: 'media' | 'book'): void {
  const home = useHomeStore();
  if (home[source].phase === 'closing') home.finishAnimation(source);
  if (home[source].phase === 'tucking') home.finishAnimation(source);
  if (home[source].phase === 'opening') home.finishAnimation(source);
  home.finishAnimation(source);
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.mocked(libraryApi.getWorkDetail).mockImplementation(async (id) => detail(id));
  vi.mocked(ehApi.getPages).mockResolvedValue(Array.from({ length: 1000 }, (_, index) => ({ index, path: `page-${index}`, width: 0, height: 0 })));
  vi.mocked(mediaApi.loadImages).mockImplementation(async (paths) => paths.map((path) => [path, `image:${path}`]));
});

describe('independent home draws', () => {
  it('commits independent pools only on reveal and does not consume failed or cancelled requests', async () => {
    useLibraryStore().works = [work(1), work(2), work(3)];
    useEhLibraryStore().galleries = [gallery(1), gallery(-1)];
    const home = useHomeStore();
    await home.draw('media'); settle('media');
    const first = home.media.current!.id;
    expect(home.media.pool.seen).toEqual([first]);
    expect(home.book.pool.seen).toEqual([]);
    await home.draw('media');
    expect(home.media.pool.seen).toEqual([first]);
    home.cancelDraws();
    expect(home.media.pool.seen).toEqual([first]);
    vi.mocked(libraryApi.getWorkDetail).mockRejectedValueOnce(new Error('offline'));
    await home.draw('media'); settle('media');
    expect(home.media.pool.seen).toEqual([first]);
    await home.draw('media'); settle('media');
    await home.draw('media'); settle('media');
    expect(new Set(home.media.pool.seen).size).toBe(3);
    await home.draw('book'); settle('book');
    expect(home.book.pool.seen).toHaveLength(1);
    expect(home.media.pool.seen).toHaveLength(3);
  });
  it('waits for presentation preparation and ignores its result after navigation cancellation', async () => {
    useLibraryStore().works = [work(1)];
    const home = useHomeStore();
    let ready!: () => void;
    const prepare = vi.fn(() => new Promise<void>((done) => { ready = done; }));
    const pending = home.draw('media', prepare);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    expect(home.media.phase).toBe('waiting');
    expect(home.media.current).toBeNull();
    expect(drawBusy(home.media)).toBe(true);
    ready();
    await pending;
    expect(home.media.phase).toBe('opening');
    settle('media');
    const previous = home.media.current;
    const cancelled = home.draw('media', prepare);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    home.cancelDraws();
    ready();
    await cancelled;
    expect(home.media.phase).toBe('idle');
    expect(home.media.current).toBe(previous);
    expect(home.media.staged).toBeNull();
  });

  it('uses the whole media library, caps screenshots and preserves browse state', async () => {
    const library = useLibraryStore();
    library.works = [work(1)];
    library.search = 'nonmatching';
    library.currentPage = 3;
    library.currentDetailWorkId = 99;
    const home = useHomeStore();
    await home.draw('media');
    expect(home.media.current?.id).toBe(1);
    expect(home.media.current?.previews).toHaveLength(3);
    expect(mediaApi.loadImages).toHaveBeenCalledWith(expect.arrayContaining(['cover-1']));
    expect(vi.mocked(mediaApi.loadImages).mock.calls[0][0]).toHaveLength(4);
    expect(library.search).toBe('nonmatching');
    expect(library.currentPage).toBe(3);
    expect(library.currentDetailWorkId).toBe(99);
    expect(useNavigationStore().activePage).toBe('page-home');
    settle('media');
    expect(drawBusy(home.media)).toBe(false);
  });

  it('loads only three unique inner pages, honors negative Hitomi ID, and never fills the reader cache', async () => {
    const books = useEhLibraryStore();
    books.galleries = [gallery(-7)];
    books.search = 'none';
    await useHomeStore().draw('book');
    const selected = useHomeStore().book.current!;
    expect(ehApi.getPages).toHaveBeenCalledWith(-7);
    expect(selected.id).toBe(-7);
    expect(selected.previews).toHaveLength(3);
    expect(new Set(selected.previews.map((item) => item.key)).size).toBe(3);
    expect(vi.mocked(mediaApi.loadImages).mock.calls[0][0]).toHaveLength(4);
    expect(books.coverCache).toEqual({});
    expect(books.search).toBe('none');
  });

  it('keeps the old face until it is turned over; repeated clicks do not issue extra requests', async () => {
    const library = useLibraryStore();
    library.works = [work(1), work(2)];
    const home = useHomeStore();
    await home.draw('media');
    settle('media');
    const previous = home.media.current;
    const draw = home.draw('media');
    await home.draw('media');
    await draw;
    expect(libraryApi.getWorkDetail).toHaveBeenCalledTimes(2);
    expect(home.media.phase).toBe('closing');
    expect(home.media.current).toBe(previous);
    expect(home.media.staged?.id).not.toBe(previous?.id);
    expect(home.media.retiring).toBe(previous);
    home.finishAnimation('media', 'closing');
    expect(home.media.phase).toBe('tucking');
    expect(home.media.current).toBe(previous);
    home.finishAnimation('media', 'closing');
    expect(home.media.phase).toBe('tucking');
    home.finishAnimation('media', 'tucking');
    expect(home.media.current?.id).not.toBe(previous?.id);
    expect(home.media.phase).toBe('opening');
    expect(home.media.retiring).toBe(previous);
    home.finishAnimation('media', 'opening');
    expect(home.media.phase).toBe('settling');
    expect(drawBusy(home.media)).toBe(true);
    home.finishAnimation('media', 'settling');
    expect(home.media.staged).toBeNull();
    expect(home.media.retiring).toBeNull();
  });

  it('parks the old card at the bottom and waits for slow loading before revealing the next card', async () => {
    useLibraryStore().works = [work(1), work(2)];
    const home = useHomeStore();
    await home.draw('media'); settle('media');
    const previous = home.media.current;
    let resolve!: (value: WorkDetail) => void;
    vi.mocked(libraryApi.getWorkDetail).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = home.draw('media');
    home.finishAnimation('media', 'closing');
    home.finishAnimation('media', 'tucking');
    expect(home.media.phase).toBe('waiting');
    expect(home.media.current).toBe(previous);
    expect(home.media.retiring).toBe(previous);
    expect(drawBusy(home.media)).toBe(true);
    resolve(detail(previous?.id === 1 ? 2 : 1));
    await pending;
    expect(home.media.phase).toBe('opening');
    expect(home.media.current?.id).not.toBe(previous?.id);
    settle('media');
    expect(drawBusy(home.media)).toBe(false);
  });

  it('removes the retired snapshot when cancelling a tuck and ignores stale animation events', async () => {
    useLibraryStore().works = [work(1), work(2)];
    const home = useHomeStore();
    await home.draw('media'); settle('media');
    const previous = home.media.current;
    await home.draw('media');
    home.finishAnimation('media', 'closing');
    expect(home.media.phase).toBe('tucking');
    home.cancelDraws();
    home.finishAnimation('media', 'tucking');
    expect(home.media.phase).toBe('idle');
    expect(home.media.retiring).toBeNull();
    expect(home.media.current).toBe(previous);
  });

  it('handles slow requests after closing and keeps the two lanes independent', async () => {
    useLibraryStore().works = [work(1)];
    useEhLibraryStore().galleries = [gallery(7)];
    let resolve!: (value: WorkDetail) => void;
    vi.mocked(libraryApi.getWorkDetail).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const home = useHomeStore();
    const pending = home.draw('media');
    await home.draw('book');
    settle('book');
    expect(drawBusy(home.media)).toBe(true);
    expect(drawBusy(home.book)).toBe(false);
    resolve(detail(1));
    await pending;
    expect(home.media.phase).toBe('opening');
  });

  it('discards late results after leaving and permits a fresh draw', async () => {
    useLibraryStore().works = [work(1)];
    let resolve!: (value: WorkDetail) => void;
    vi.mocked(libraryApi.getWorkDetail).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const home = useHomeStore();
    const pending = home.draw('media');
    home.cancelDraws();
    resolve(detail(1));
    await pending;
    expect(home.media.current).toBeNull();
    expect(drawBusy(home.media)).toBe(false);
    await home.draw('media');
    expect(home.media.current?.id).toBe(1);
  });

  it('restores the previous work on failure and allows another try', async () => {
    useLibraryStore().works = [work(1), work(2)];
    const home = useHomeStore();
    await home.draw('media');
    settle('media');
    const previous = home.media.current;
    vi.mocked(libraryApi.getWorkDetail).mockRejectedValueOnce(new Error('offline'));
    await home.draw('media');
    settle('media');
    expect(home.media.current).toBe(previous);
    expect(home.media.error).toContain('offline');
    expect(drawBusy(home.media)).toBe(false);
    await home.draw('media');
    settle('media');
    expect(home.media.error).toBe('');
    expect(home.media.current?.id).not.toBe(previous?.id);
  });

  it('handles empty, missing-cover, no-episode and single-page works', async () => {
    const home = useHomeStore();
    await home.draw('media');
    expect(home.media.current).toBeNull();
    expect(drawBusy(home.media)).toBe(false);
    useLibraryStore().works = [{ ...work(1), cover_path: null }];
    vi.mocked(libraryApi.getWorkDetail).mockResolvedValue({ ...detail(1), episodes: [] });
    await home.draw('media');
    expect(home.media.current?.cover).toBe('');
    expect(home.media.current?.previews).toEqual([]);
    useEhLibraryStore().galleries = [gallery(7)];
    vi.mocked(ehApi.getPages).mockResolvedValue([{ index: 0, path: 'page-0', width: 0, height: 0 }]);
    await home.draw('book');
    expect(home.book.current?.previews).toHaveLength(1);
  });

  it('opens the exact drawn media or book and returns to home', async () => {
    useLibraryStore().works = [work(1)];
    useEhLibraryStore().galleries = [gallery(-7)];
    const home = useHomeStore();
    const navigation = useNavigationStore();
    await home.draw('media'); settle('media');
    await home.openDetail('media');
    expect(useLibraryStore().currentDetailWorkId).toBe(1);
    expect(navigation.activePage).toBe('page-detail');
    expect(navigation.backPage).toBe('page-home');
    navigation.showPage('page-home');
    await home.draw('book'); settle('book');
    await home.openDetail('book');
    expect(useEhLibraryStore().currentGallery?.gid).toBe(-7);
    expect(useEhLibraryStore().coverUrl('book--7')).toBe('image:book--7');
    expect(navigation.detailSource).toBe('eh');
    expect(navigation.backPage).toBe('page-home');
  });

  it('opens a hand selection independently of the current draw, including signed book IDs', async () => {
    const home = useHomeStore();
    const navigation = useNavigationStore();
    useLibraryStore().works = [work(1), work(2)];
    useEhLibraryStore().galleries = [gallery(7), gallery(-7)];
    await home.draw('media'); settle('media');
    const drawn = home.media.current?.id;
    const selected = drawn === 1 ? 2 : 1;
    await home.openDetail('media', selected);
    expect(useLibraryStore().currentDetailWorkId).toBe(selected);
    expect(home.media.current?.id).toBe(drawn);
    expect(navigation.backPage).toBe('page-home');
    navigation.showPage('page-home');
    await home.openDetail('book', -7);
    expect(useEhLibraryStore().currentGallery?.gid).toBe(-7);
    expect(navigation.backPage).toBe('page-home');
  });

  it('does not navigate or load details while a card is turning or the home is hidden', async () => {
    useLibraryStore().works = [work(1)];
    const home = useHomeStore();
    await home.draw('media');
    await home.openDetail('media');
    expect(libraryApi.getWorkDetail).toHaveBeenCalledTimes(1);
    settle('media');
    useNavigationStore().showPage('page-settings');
    await home.openDetail('media');
    expect(useNavigationStore().activePage).toBe('page-settings');
  });

  it('does not hijack navigation when detail loading finishes after leaving and returning home', async () => {
    useLibraryStore().works = [work(1)];
    const home = useHomeStore();
    await home.draw('media'); settle('media');
    let resolve!: (value: WorkDetail) => void;
    vi.mocked(libraryApi.getWorkDetail).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = home.openDetail('media');
    const navigation = useNavigationStore();
    navigation.showPage('page-settings');
    navigation.showPage('page-home');
    resolve(detail(1)); await pending;
    expect(navigation.activePage).toBe('page-home');
    expect(useLibraryStore().currentDetailWorkId).toBeNull();
    expect(home.media.openingDetail).toBe(false);
    expect(home.media.error).toBe('');
  });

  it('never reveals a work removed from the library during a pending draw', async () => {
    useLibraryStore().works = [work(1)];
    let resolve!: (value: WorkDetail) => void;
    vi.mocked(libraryApi.getWorkDetail).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const home = useHomeStore();
    const pending = home.draw('media');
    useLibraryStore().works = [];
    home.ensureSelections();
    resolve(detail(1)); await pending;
    expect(home.media.current).toBeNull();
    expect(drawBusy(home.media)).toBe(false);
  });
});
