import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { accountScope, setAccountScope } from '../../api/accountContext';
import { accountApi } from '../../api/commands/accounts';
import { libraryApi } from '../../api/commands/library';
import type { WorkDetail, WorkSummary } from '../../api/contracts/library';
import { useLibraryStore } from '../../stores/library';
import { useHomeStore } from '../../stores/home';
import { usePlayerRandomStore } from '../../stores/playerRandom';
import { playRandomWork } from './randomPlayback';

vi.mock('../../api/commands/accounts', () => ({ accountApi: { get: vi.fn(), set: vi.fn() } }));
vi.mock('../../api/commands/library', () => ({ libraryApi: { getWorkDetail: vi.fn() } }));
function detail(id: number): WorkDetail {
  return { work: { id, title: `作品 ${id}`, episode_count: 3, cover_path: null } as WorkSummary,
    episodes: [3, 1, 2].map(number => ({ id: id * 10 + number, work_id: id, number, video_path: `video-${id}-${number}` })), tags: [], characters: [] };
}
const data = new Map<string, string>();
beforeEach(() => {
  setActivePinia(createPinia()); setAccountScope('account-a'); vi.clearAllMocks(); data.clear();
  vi.mocked(accountApi.get).mockImplementation(async (_kind, item, scope) => data.get(`${scope}:${item}`) || null);
  vi.mocked(accountApi.set).mockImplementation(async (_kind, item, value, scope) => { data.set(`${scope}:${item}`, value); });
  vi.mocked(libraryApi.getWorkDetail).mockImplementation(async id => detail(id));
  const library = useLibraryStore(); library.works = Array.from({ length: 6 }, (_, i) => detail(i + 1).work);
  library.currentDetail = detail(1); library.currentDetailWorkId = 1;
  vi.spyOn(library, 'loadCovers').mockResolvedValue(); vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => { vi.restoreAllMocks(); setAccountScope(''); });

describe('work-level random playback', () => {
  it('starts another work with episode one, independent of library filters and home pools', async () => {
    const home = useHomeStore(); home.media.pool = { seen: [2, 3, 4], recent: [4] };
    const library = useLibraryStore(); library.search = '当前筛选无匹配';
    const load = vi.fn().mockResolvedValue(true);
    await playRandomWork({ valid: () => true, load, report: vi.fn() });
    const [work, episode] = load.mock.calls[0]!;
    expect(work.work.id).not.toBe(1); expect(episode.number).toBe(1);
    expect(work.episodes.map((e: { number: number }) => e.number)).toEqual([1, 2, 3]);
    expect(home.media.pool).toEqual({ seen: [2, 3, 4], recent: [4] });
    expect(usePlayerRandomStore().pool.seen).toEqual([1, work.work.id]);
  });
  it('completes cycles and avoids the recent half of the library across cycle boundaries', async () => {
    const history = [1], library = useLibraryStore();
    for (let index = 0; index < 29; index++) {
      await playRandomWork({ valid: () => true, report: vi.fn(), load: async work => {
        expect(history.slice(-3)).not.toContain(work.work.id); history.push(work.work.id); library.currentDetail = work; return true;
      } });
    }
    for (let index = 0; index < history.length; index += 6) expect(new Set(history.slice(index, index + 6)).size).toBe(6);
    expect(usePlayerRandomStore().pool.recent.length).toBeLessThanOrEqual(20);
  });
  it('skips unavailable/empty works once per attempt without consuming them', async () => {
    useLibraryStore().works = [1, 2, 3, 4].map(id => detail(id).work);
    vi.mocked(libraryApi.getWorkDetail).mockImplementation(async id => {
      if (id === 2) throw Error('removed');
      return id === 3 ? { ...detail(id), episodes: [] } : detail(id);
    });
    const load = vi.fn().mockResolvedValue(true);
    await playRandomWork({ valid: () => true, load, report: vi.fn() });
    expect(load.mock.calls[0]![0].work.id).toBe(4);
    expect(usePlayerRandomStore().pool.seen).toEqual([1, 4]);
    expect(libraryApi.getWorkDetail).toHaveBeenCalledTimes(3);
  });
  it('never chooses the current work when it is the only playable work', async () => {
    useLibraryStore().works = [detail(1).work];
    const load = vi.fn(), report = vi.fn();
    await playRandomWork({ valid: () => true, load, report });
    expect(load).not.toHaveBeenCalled(); expect(report).toHaveBeenCalledWith(expect.stringContaining('没有其他'));
  });
  it.each(['cancelled', 'failed'])('does not commit a candidate whose native start was %s', async result => {
    const load = result === 'failed' ? vi.fn().mockRejectedValue(Error('load failed')) : vi.fn().mockResolvedValue(false);
    const pending = playRandomWork({ valid: () => true, load, report: vi.fn() });
    if (result === 'failed') await expect(pending).rejects.toThrow('load failed'); else await pending;
    expect(usePlayerRandomStore().pool.seen).toEqual([1]);
  });
  it('discards a late detail response after locking or navigation without starting native playback', async () => {
    let resolve!: (value: WorkDetail) => void, valid = true;
    vi.mocked(libraryApi.getWorkDetail).mockImplementation(() => new Promise(done => { resolve = done; }));
    const load = vi.fn(), pending = playRandomWork({ valid: () => valid, load, report: vi.fn() });
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    valid = false; resolve(detail(2)); await pending; expect(load).not.toHaveBeenCalled();
  });
  it('restores history across store recreation and isolates account changes/late responses', async () => {
    const original = usePlayerRandomStore(); await original.restore(); await original.rememberCurrent([1, 2, 3], 1); await original.commit([1, 2, 3], 2);
    setActivePinia(createPinia()); const restored = usePlayerRandomStore(); await restored.restore(); expect(restored.pool.seen).toEqual([1, 2]);
    let resolve!: (value: string | null) => void;
    vi.mocked(accountApi.get).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    setAccountScope('account-b'); const pending = restored.restore();
    setAccountScope('account-c'); await restored.restore(); resolve('{"seen":[99],"recent":[99]}'); await pending;
    expect(restored.owner).toBe(accountScope()); expect(restored.pool).toEqual({ seen: [], recent: [] });
    setAccountScope('account-a'); await restored.restore(); expect(restored.pool.seen).toEqual([1, 2]);
  });
});
