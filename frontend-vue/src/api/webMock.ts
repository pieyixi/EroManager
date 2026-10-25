import { mockAccounts } from './mock/accounts';
import type { ArchiveDraft } from './contracts/archive';
import type { TagSummary, WorkDetail, WorkSummary, UnarchivedItem } from './contracts/library';
import type { EhGallerySummary } from './contracts/eh';
import { createDownloadScene } from './mock/downloadScene';
import { createAvScene } from './mock/avScene';
let avWorks = createAvScene();
let avRoot = 'D:\\MockAvLibrary';
import type { UserPreferences, WorkRecord } from './contracts/preferences';

type InvokeArgs = Record<string, unknown>;
type MockHandler = (args: InvokeArgs) => unknown | Promise<unknown>;
const mockListeners = new Map<string, Set<(payload: unknown) => void>>();
async function simulateDownload(event: string, gid: number, total: number): Promise<void> {
  for (let step = 1; step <= 3; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 360));
    const payload = {
      gid, page: Math.round(total * step / 3), total_pages: total,
      percent: Math.round(step / 3 * 100), text: `已处理 ${Math.round(total * step / 3)} / ${total} 页`,
    };
    mockListeners.get(event)?.forEach((handler) => handler(payload));
  }
}

const palette = [
  ['#f5b7c7', '#6d3850'], ['#b9d9f3', '#315a78'], ['#d9c5ef', '#59416f'],
  ['#bfe2d0', '#355f50'], ['#f0d6a8', '#765833'], ['#c8d2ee', '#3d4e78'],
];

function coverData(title: string, index: number, landscape = false): string {
  const [light, dark] = palette[index % palette.length];
  const width = landscape ? 640 : 360;
  const height = landscape ? 360 : 480;
  const safeTitle = title.replace(/[&<>"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${light}"/><circle cx="${width * .72}" cy="${height * .2}" r="${height * .23}" fill="${dark}" opacity=".18"/><path d="M0 ${height * .78} Q ${width * .35} ${height * .55} ${width} ${height * .72} V${height}H0Z" fill="${dark}" opacity=".28"/><text x="24" y="${height - 54}" font-family="sans-serif" font-size="24" font-weight="700" fill="${dark}">${safeTitle.slice(0, 18)}</text><text x="24" y="${height - 24}" font-family="sans-serif" font-size="14" fill="${dark}" opacity=".75">WEB MOCK</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const storyTags = ['纯爱', '恋爱喜剧', '悬疑', '奇幻'];
const attributeTags = ['制服', '长发', '眼镜', '成熟'];
const sceneTags = ['校园', '温泉', '公共场所', '室内'];
const studios = ['Studio A', 'Studio B', 'Studio C'];

const works: WorkSummary[] = Array.from({ length: 48 }, (_, index) => {
  const id = index + 1;
  const year = 2026 - Math.floor(index / 8);
  const month = 12 - (index % 12);
  return {
    id,
    title: ['春日档案', '夏夜回声', '秋色手记', '冬日来信', '星光收藏', '午后物语'][index % 6] + ` ${String(id).padStart(2, '0')}`,
    search_aliases: [`示例作品${id}`, `Mock ${id}`],
    year,
    month,
    release_dates: [`${year}-${String(month).padStart(2, '0')}`],
    studio: studios[index % studios.length],
    description: '这是浏览器开发模式使用的界面验证数据，用于检查长文本、筛选、分页和详情布局。',
    cover_path: `mock://cover/${id}`,
    folder_path: `D:\\MockLibrary\\Work-${id}`,
    episode_count: id % 5 + 2,
    tags: [
      { id: id * 10 + 1, name: storyTags[index % storyTags.length], category: '剧情' },
      { id: id * 10 + 2, name: attributeTags[index % attributeTags.length], category: '属性' },
      { id: id * 10 + 3, name: sceneTags[index % sceneTags.length], category: '场景' },
      { id: id * 10 + 4, name: `角色${index % 9 + 1}`, category: '人物' },
    ],
  };
});

const unarchived: UnarchivedItem[] = Array.from({ length: 36 }, (_, index) => ({
  title: ['待整理作品', '旧档案', '新收录', '资料缺失'][index % 4] + ` ${String(index + 1).padStart(2, '0')}`,
  folder_path: `D:\\MockLibrary\\Work-${index + 1}`,
  video_count: index % 5 + 1,
  has_data_dir: index % 4 !== 0,
  has_meta_json: index % 3 !== 0,
  missing_reasons: index % 3 === 0 ? ['缺少主封面', '缺少第1集封面'] : ['meta.json 信息不完整'],
}));

let ehGalleries: EhGallerySummary[] = Array.from({ length: 42 }, (_, index) => {
  const gid = 440955 + index * 137;
  return {
    gid,
    token: `mock-token-${gid}`,
    source: 'eh',
    source_id: String(gid),
    language: '',
    title: ['ラブプレグ', 'Garden Notes', '夏色アーカイブ', '星降る夜の記録', '午後のスケッチ', '冬のアルバム'][index % 6] + ` ${index + 1}`,
    category: [2, 4, 8][index % 3],
    artist: [`artist-${index % 8 + 1}`],
    group: [`circle-${index % 6 + 1}`],
    tags: ['sole female', ['schoolgirl', 'glasses', 'long hair', 'swimsuit'][index % 4], ['original', 'full color', 'story arc'][index % 3]],
    artist_display: [`artist-${index % 8 + 1}`],
    group_display: [`circle-${index % 6 + 1}`],
    tags_display: ['sole female', ['schoolgirl', 'glasses', 'long hair', 'swimsuit'][index % 4], ['original', 'full color', 'story arc'][index % 3]],
    pages: 18 + index % 64,
    posted: `${2010 - Math.floor(index / 8)}-${String(12 - index % 12).padStart(2, '0')}-08`,
    added_at: `2026-08-${String(31 - index % 28).padStart(2, '0')} 12:00:00`,
    cover_path: `mock://eh-cover/${gid}`,
    folder_path: `D:\\MockEhLibrary\\${gid}-Gallery-${index + 1}`,
  };
});
let ehSettings = {
  root_path: 'D:\\MockEhLibrary',
  ipb_member_id: '', ipb_pass_hash: '', igneous: '',
};
ehGalleries[0] = {
  gid: 440955,
  token: 'mock-token-440955',
  source: 'eh',
  source_id: '440955',
  language: '',
  title: 'ラブプレグ',
  category: 2,
  artist: ['ミサキ糖'],
  group: ['MISAKIX MEGAMIX'],
  tags: ['blowjob', 'impregnation', 'lactation', 'netorare', 'pregnant', 'vaginal birth', 'x-ray'],
  artist_display: ['ミサキ糖'],
  group_display: ['MISAKIX MEGAMIX'],
  tags_display: ['blowjob', 'impregnation', 'lactation', 'netorare', 'pregnant', 'vaginal birth', 'x-ray'],
  pages: 38,
  posted: '2011-12-08',
  added_at: '2026-08-31 12:00:00',
  cover_path: 'mock://eh-cover/440955',
  folder_path: 'D:\\MockEhLibrary\\440955-Gallery',
};

ehGalleries.push(...createDownloadScene().galleries);
let favoriteGalleryGids: number[] = [];

function allTags(): TagSummary[] {
  const tags = works.flatMap((work) => work.tags || []);
  return [...new Map(tags.map((tag) => [`${tag.category}:${tag.name}`, tag])).values()];
}

function detail(workId: number): WorkDetail {
  const work = works.find((item) => item.id === workId) || works[0];
  const id = Number(work.id || 1);
  const characters = (work.tags || []).filter((tag) => tag.category === '人物').map((tag) => tag.name);
  return {
    work: { ...work, id, folder_path: `D:\\MockLibrary\\Work-${id}` },
    tags: work.tags || [],
    characters,
    episodes: Array.from({ length: id % 5 + 2 }, (_, index) => ({
      id: index + 1,
      work_id: id,
      number: index + 1,
      title: index % 2 ? `第 ${index + 1} 集副标题` : '',
      subtitle: index % 2 ? `第 ${index + 1} 集副标题` : '',
      release_date: `${work.year}-${String((index % 12) + 1).padStart(2, '0')}`,
      video_path: `mock://video/${id}/${index + 1}`,
      cover_path: `mock://episode/${id}/${index + 1}`,
    })),
  };
}

function archiveDraft(dirPath: string): ArchiveDraft {
  return {
    dir_path: dirPath,
    title: dirPath.split(/[\\/]/).filter(Boolean).at(-1) || '待建档作品',
    search_aliases: [], studio: '', synopsis: '', characters: {}, episodes: 3,
    episode_list: Array.from({ length: 3 }, (_, index) => ({
      id: index + 1, subtitle: '', release_date: '', video_path: `${dirPath}\\episode-${index + 1}.mp4`, cover_path: null,
      tags: { theme: [], attribute: [], scene: [] },
    })),
    cover_path: null,
    getchu_url: '',
    hanime_url: '',
  };
}

const summary = { archived_count: works.length, unarchived_count: unarchived.length, episode_count: 137, total_bytes: 892_000_000_000 };
const emptyScan = { summary, changed_works: [], new_episode_works: [], new_complete_works: [], attention_works: [] };
const ehCategoryMetrics = [
  { category: 1, label: 'Misc', count: 1, bytes: 120_000_000 },
  { category: 2, label: 'Doujinshi', count: 15, bytes: 2_620_000_000 },
  { category: 4, label: 'Manga', count: 8, bytes: 1_460_000_000 },
  { category: 8, label: 'Artist CG', count: 5, bytes: 820_000_000 },
  { category: 16, label: 'Game CG', count: 4, bytes: 670_000_000 },
  { category: 32, label: 'Image Set', count: 3, bytes: 510_000_000 },
  { category: 64, label: 'Cosplay', count: 2, bytes: 360_000_000 },
  { category: 128, label: 'Asian Porn', count: 1, bytes: 240_000_000 },
  { category: 256, label: 'Non-H', count: 2, bytes: 280_000_000 },
  { category: 512, label: 'Western', count: 1, bytes: 190_000_000 },
];

const handlers: Record<string, MockHandler> = {
  av_list_works: ({ scope }) => { mockAccounts.get(scope, 'av-browse', ''); const root=avRoot.replace(/\\+$/, '').toLowerCase()+'\\'; return structuredClone(avWorks.filter(work=>work.folder_path.toLowerCase().startsWith(root))); },
  av_get_settings: ({ scope }) => { mockAccounts.get(scope, 'av-browse', ''); return { root_path: avRoot }; },
  av_get_local_videos: ({ scope, code }) => { mockAccounts.get(scope, 'av-browse', ''); return structuredClone(avWorks.find(work => work.code === String(code))?.videos || []); },
  av_bind_root: ({ scope, rootPath }) => { mockAccounts.get(scope, 'av-browse', ''); if (!String(rootPath).trim()) throw Error('请选择资料目录'); avRoot = String(rootPath); return { root_path: avRoot }; },
  av_fetch_work: async ({ scope, code, queuedAt }) => {
    mockAccounts.get(scope, 'av-browse', '');
    const normalized = String(code).trim().toUpperCase().replace(/^([A-Z]{2,12})(\d{2,9})$/, '$1-$2');
    if (!/^(?:[A-Z][A-Z0-9]{1,15}-\d{2,9}|FC2-PPV-\d{3,10})$/.test(normalized)) throw Error('请输入有效番号');
    await new Promise(resolve => setTimeout(resolve, 650));
    if (normalized === 'MISSING-404') throw Error('没有找到完全匹配的番号');
    const old = avWorks.find(work => work.code === normalized);
    const work = { ...structuredClone(old || createAvScene()[0]!), code: normalized, title: old?.title || '春の日記（ブラウザー開発用サンプル）',
      folder_path: `${avRoot}\\${normalized}`, source_url: `https://javdb.com/v/mock${normalized.replace(/-/g, '')}`, queued_at: old?.queued_at || new Date(Number(queuedAt)).toISOString(), magnets: old?.magnets || [], videos: old?.videos || [] };
    avWorks = [work, ...avWorks.filter(item => item.code !== normalized)];
    return { work: structuredClone(work), warnings: [] };
  },
  av_add_magnet: ({ scope, code, magnet }) => {
    mockAccounts.get(scope, 'av-browse', '');
    const work = avWorks.find(work => work.code === String(code)); const value = String(magnet).trim();
    if (!work) throw Error('作品尚未建档'); if (!value.startsWith('magnet:?') || value.length > 8192) throw Error('请输入有效磁力链接');
    if (!work.magnets.includes(value)) work.magnets.push(value); return structuredClone(work);
  },
  av_remove_magnet: ({ scope, code, magnet }) => {
    mockAccounts.get(scope, 'av-browse', '');
    const work = avWorks.find(work => work.code === String(code));
    if (!work) throw Error('作品尚未建档');
    work.magnets = work.magnets.filter(value => value !== String(magnet).trim());
    return structuredClone(work);
  },
  account_state: () => mockAccounts.state(),
  account_auth: ({ id, pin }) => mockAccounts.auth(String(id), String(pin)),
  account_lock: () => mockAccounts.lock(),
  account_logout: () => mockAccounts.logout(),
  account_update_profile: ({ scope, nickname, avatar }) => mockAccounts.profile(scope, String(nickname), String(avatar)),
  account_change_pin: ({ scope, newPin }) => mockAccounts.pin(scope, String(newPin)),
  account_get_data: ({ scope, kind, item }) => mockAccounts.get(scope, String(kind), String(item)),
  account_set_data: ({ scope, kind, item, value }) => mockAccounts.set(scope, String(kind), String(item), String(value)),
  get_user_preferences: ({ scope }) => mockAccounts.preferences(scope),
  set_user_preferences: ({ scope, preferences }) => mockAccounts.savePreferences(scope, preferences as UserPreferences),
  get_work_record: ({ scope, kind, contentId }) => mockAccounts.getRecord(scope, String(kind), Number(contentId)),
  set_work_record: ({ scope, record }) => mockAccounts.setRecord(scope, record as WorkRecord),
  get_application_info: () => ({ version: '6.0.0', app_directory: '浏览器预览', database_directory: '浏览器独立数据' }),
  initialize_media_library: () => ({ root_path: 'D:\\MockLibrary', source: 'previous', rebound_paths: 0, needs_binding: false }),
  bind_media_library: ({ rootPath }) => ({ root_path: String(rootPath || 'D:\\MockLibrary'), source: 'manual', rebound_paths: 0, needs_binding: false }),
  apply_library_updates: () => 0,
  batch_import_folders: () => 0,
  backup_database: () => undefined,
  backup_data_package: ({ backupPath }) => String(backupPath || 'D:\\MockLibrary\\backup.zip'),
  restore_database: () => undefined,
  get_all_works_with_tags: () => structuredClone(works),
  get_tags: () => allTags(),
  get_studios: () => [...studios],
  get_favorite_characters: ({ scope }) => mockAccounts.favorites(scope, 'favorite-media'),
  set_character_favorite: ({ scope, characterName, favorite }) => {
    mockAccounts.favorite(scope, 'favorite-media', String(characterName).trim(), Boolean(favorite));
    return mockAccounts.favorites(scope, 'favorite-media');
  },
  get_work_detail: ({ workId }) => detail(Number(workId)),
  import_work_via_json: () => 1,
  prepare_temp_frame_capture: () => ({ path: 'mock://temp/frame.jpg' }),
  read_image_data: () => ({ image_data: coverData('截图', 0) }),
  get_video_thumbnail: ({ time }) => ({ time: Number(time || 0), image_data: coverData('预览', Number(time || 0)) }),
  prime_video_thumbnail: () => ({ image_data: coverData('预览', 0) }),
  prefetch_video_thumbnails: ({ times }) => (times as number[] || []).map((time) => ({ time, image_data: coverData('预览', time) })),
  release_video_thumbnail_decoders: () => undefined,
  play_video: () => undefined,
  set_player_fullscreen: () => undefined,
  save_archive_cover: () => 'D:\\MockLibrary\\data\\cover.jpg',
  save_archive_draft: () => 'D:\\MockLibrary\\data\\meta.json',
  save_archive_episode_covers: () => [],
  save_archive_json: () => 'D:\\MockLibrary\\data\\meta.json',
  load_cover_cache: ({ coverPaths }) => (coverPaths as string[] || []).map((path, index) => [path, path.startsWith('/@fs/') ? path : coverData(path, index, path.includes('episode') || path.includes('av-preview') || (path.includes('eh-page') && /\/(8|19)$/.test(path)))]),
  eh_delete_gallery_record: ({ gid }) => {
    ehGalleries = ehGalleries.filter((gallery) => gallery.gid !== Number(gid));
    favoriteGalleryGids = favoriteGalleryGids.filter(value => value !== Number(gid));
    return null;
  },
  eh_delete_gallery_folder: ({ gid }) => {
    ehGalleries = ehGalleries.filter((gallery) => gallery.gid !== Number(gid));
    favoriteGalleryGids = favoriteGalleryGids.filter(value => value !== Number(gid));
    return null;
  },
  hitomi_delete_gallery_folder: ({ id }) => {
    ehGalleries = ehGalleries.filter((gallery) => gallery.gid !== -Number(id));
    favoriteGalleryGids = favoriteGalleryGids.filter(value => value !== -Number(id));
    return null;
  },
  list_unarchived_folders: () => structuredClone(unarchived),
  ensure_archive_data_dir: ({ dirPath }) => `${String(dirPath)}\\data`,
  inspect_archive_folder: ({ dirPath }) => archiveDraft(String(dirPath || 'D:\\MockLibrary\\Draft')),
  get_library_console_summary: () => ({ ...summary }),
  scan_library_changes: () => structuredClone(emptyScan),
  detect_duplicates: () => [],
  eh_get_library_overview: () => ({
    root_path: 'D:\\EhLibrary\\download', database_path: 'D:\\MockApp\\db\\database.db',
    total_count: ehGalleries.length,
    total_pages: ehGalleries.reduce((total, gallery) => total + gallery.pages, 0),
  }),
  eh_get_library_dashboard: () => ({
    total_count: ehCategoryMetrics.reduce((total, item) => total + item.count, 0),
    total_pages: 2_184,
    total_bytes: ehCategoryMetrics.reduce((total, item) => total + item.bytes, 0),
    categories: structuredClone(ehCategoryMetrics),
  }),
  eh_list_local_galleries: () => structuredClone(ehGalleries),
  eh_get_favorite_galleries: ({ scope }) => mockAccounts.favorites(scope, 'favorite-book').map(Number).filter(gid => ehGalleries.some(gallery => gallery.gid === gid)),
  eh_set_gallery_favorite: ({ scope, gid, favorite }) => {
    const id = Number(gid);
    if (favorite && !ehGalleries.some(gallery => gallery.gid === id)) throw new Error('作品不存在，无法收藏');
    mockAccounts.favorite(scope, 'favorite-book', String(id), Boolean(favorite)); return Boolean(favorite);
  },
  eh_get_settings: () => structuredClone(ehSettings),
  eh_save_settings: ({ input }) => {
    const value = input as Record<string, string>;
    ehSettings = { root_path: value.rootPath, ipb_member_id: value.ipbMemberId, ipb_pass_hash: value.ipbPassHash, igneous: value.igneous };
    return structuredClone(ehSettings);
  },
  eh_download_gallery: async ({ input }) => {
    const value = input as { gid?: number; token?: string; pageIndices?: number[] };
    const gid = Number(value.gid || 0);
    if (!Number.isSafeInteger(gid) || gid <= 0 || !value.token?.trim()) throw new Error('GID 或 Token 无效');
    const gallery = ehGalleries.find((item) => item.gid === gid) || {
      ...ehGalleries[0], gid, source_id: String(gid), token: value.token,
      title: `Eh 示例作品 ${gid}`, pages: 28,
      folder_path: `D:\\MockEhLibrary\\${gid}-sample`, cover_path: `mock://cover/eh-${gid}`,
    };
    const selected = value.pageIndices?.length ? value.pageIndices.length : gallery.pages;
    await simulateDownload('eh-download-progress', gid, selected);
    ehGalleries = [{ ...gallery, added_at: new Date().toISOString() }, ...ehGalleries.filter((item) => item.gid !== gid)];
    return {
      gid: gallery.gid,
      title: gallery.title,
      folder_path: gallery.folder_path,
      total_pages: gallery.pages,
      downloaded_pages: selected,
      failures: [],
      meta_path: `${gallery.folder_path}\\data\\meta.json`,
      cover_path: gallery.cover_path,
    };
  },
  hitomi_download_gallery: async ({ input }) => {
    const value = input as { id?: number; pageIndices?: number[] };
    const id = Number(value.id || 0);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('请输入有效的 Hitomi ID');
    await simulateDownload('hitomi-download-progress', -id, value.pageIndices?.length || 30);
    const gallery: EhGallerySummary = {
      gid: -id, token: '', source: 'hitomi', source_id: String(id), language: 'japanese',
      title: `Hitomi 示例作品 ${id}`, category: 4, artist: ['示例画师'], group: [], tags: ['sample'],
      artist_display: ['示例画师'], group_display: [], tags_display: ['示例'], pages: 30,
      posted: '2026-01-01 00:00:00', added_at: new Date().toISOString(),
      cover_path: `mock://cover/hitomi-${id}`, folder_path: `D:\\MockEhLibrary\\hitomi-${id}-sample`,
    };
    ehGalleries = [gallery, ...ehGalleries.filter((item) => item.gid !== -id)];
    return { gid: -id, title: gallery.title, folder_path: gallery.folder_path, total_pages: gallery.pages,
      downloaded_pages: gallery.pages, failures: [], meta_path: `${gallery.folder_path}\\data\\meta.json`, cover_path: gallery.cover_path };
  },
  eh_get_gallery_pages: ({ gid }) => Array.from({ length: Number(gid) < 0 ? 30 : Number(gid) === 440955 ? 38 : 28 }, (_, index) => ({ index, path: `mock://eh-page/${gid}/${index + 1}`, width: index === 7 || index === 18 ? 1600 : 1000, height: index === 7 || index === 18 ? 1000 : 1500 })),
  eh_bind_local_library: ({ rootPath }) => ({ ...ehSettings, root_path: String(rootPath) }),
  eh_scan_local_library: () => ({ folders: 10, indexed: 10, created_meta: 9, created_cover: 9, removed_records: 0, skipped: 0, errors: [] }),
  open_folder: () => undefined,
  apply_close_action: () => undefined,
  delete_work: ({ workId }) => {
    const index = works.findIndex((work) => work.id === Number(workId));
    if (index >= 0) works.splice(index, 1);
  },
};

export async function invokeBrowserMock<T>(command: string, args: InvokeArgs = {}): Promise<T> {
  if (command === 'eh_get_library_dashboard') {
    const delay = Number(new URLSearchParams(location.search).get('statsDelay') || 0);
    if (Number.isFinite(delay) && delay > 0) await new Promise(resolve => setTimeout(resolve, Math.min(delay, 30_000)));
  }
  const handler = handlers[command];
  if (!handler) throw new Error(`Web Mock 尚未实现命令: ${command}`);
  return await handler(args) as T;
}

export function listenBrowserMock<T>(event: string, handler: (payload: T) => void): () => void {
  let listeners = mockListeners.get(event);
  if (!listeners) { listeners = new Set(); mockListeners.set(event, listeners); }
  const listener = handler as (payload: unknown) => void;
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (!listeners?.size) mockListeners.delete(event);
  };
}
