import { describe, expect, it } from 'vitest';
import { invokeBrowserMock } from './webMock';

describe('browser mock backend', () => {
  it('provides a coherent library contract', async () => {
    const works = await invokeBrowserMock<Array<{ id: number; cover_path: string }>>('get_all_works_with_tags');
    const detail = await invokeBrowserMock<{ work: { id: number }; episodes: unknown[] }>('get_work_detail', { workId: works[0].id });
    const covers = await invokeBrowserMock<Array<[string, string]>>('load_cover_cache', { coverPaths: [works[0].cover_path] });

    expect(works.length).toBeGreaterThan(20);
    expect(detail.work.id).toBe(works[0].id);
    expect(detail.episodes.length).toBeGreaterThan(1);
    expect(covers[0][1]).toMatch(/^data:image\/svg\+xml/);
  });

  it('rejects unsupported desktop-only commands explicitly', async () => {
    await expect(invokeBrowserMock('plugin:libmpv|initialize')).rejects.toThrow('Web Mock 尚未实现命令');
  });

  it('provides local gallery fixtures with matching overview totals', async () => {
    const galleries = await invokeBrowserMock<Array<{ pages: number }>>('eh_list_local_galleries');
    const overview = await invokeBrowserMock<{ total_count: number; total_pages: number }>('eh_get_library_overview');
    expect(overview.total_count).toBe(galleries.length);
    expect(overview.total_pages).toBe(galleries.reduce((total, gallery) => total + gallery.pages, 0));
  });
});
