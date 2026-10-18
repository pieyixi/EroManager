import type { EhGallerySummary } from '../contracts/eh';

/** 浏览器默认展示快照，不发起下载、不写入历史或正式资料。 */
export function createDownloadScene() {
  const queue = [];
  const history = [];
  const galleries: EhGallerySummary[] = [];
  for (const source of ['eh', 'hitomi'] as const) {
    for (let index = 0; index < 8; index++) {
      const id = 900101 + index;
      const gid = source === 'eh' ? id : -id;
      const name = source === 'eh' ? 'Eh' : 'Hitomi';
      const title = index === 1 ? `${name} · A long sample title — 多语言长标题的封面卡片排版与省略测试`
        : `${name} · ${['等待出发', '晴空记录', '未完成的章节', '暂时失联', '午后花园', '月光来信', '冬日手记', '星河档案'][index]}`;
      const coverPath = index === 3 ? '' : `mock://download-cover/${source}/${id}`;
      const folderPath = `D:\\MockEhLibrary\\${source}-${id}`;
      const queuedAt = new Date(Date.UTC(2026, 9, 14, 10, 0) - index * 60_000).toISOString();
      const totalPages = 48 + index * 12;
      if (index < 2) {
        queue.push({ key: `${source}:${id}`, source, id, title,
          status: index === 0 ? 'queued' as const : 'downloading' as const,
          progressPercent: index === 0 ? 0 : 45, progressText: index === 0 ? '等待下载' : `已处理 27 / ${totalPages} 页`,
          totalPages, downloadedPages: index === 0 ? 0 : 27, coverPath, queuedAt });
      } else {
        const failedPages = index === 2 ? [7, 18, 36] : [];
        history.push({ gid, source, title, folderPath: index === 3 ? '' : folderPath, coverPath,
          totalPages: index === 3 ? 0 : totalPages,
          downloadedPages: index === 3 ? 0 : totalPages - failedPages.length,
          failedPages, failures: failedPages.map(page => ({ page, reason: `第 ${page} 页连接超时，请重试` })),
          queuedAt, completedAt: queuedAt,
          ...(index === 3 ? { error: '获取作品信息失败：示例连接超时，可重新下载' } : {}) });
        if (index >= 4) galleries.push({ gid, source, source_id: String(id), token: '', language: source === 'hitomi' ? 'japanese' : '',
          title, category: 2, artist: ['Sample Artist'], group: ['Sample Circle'], tags: ['sample'],
          artist_display: ['示例画师'], group_display: ['示例社团'], tags_display: ['示例'],
          pages: totalPages, posted: '2026-10-01', added_at: queuedAt, cover_path: coverPath, folder_path: folderPath });
      }
    }
  }
  return { queue, history, galleries };
}
