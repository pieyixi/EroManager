import type { ArchiveDraft, TagSummary, WorkDetail, WorkSummary } from '../stores/app';
import type { UnarchivedItem } from '../stores/archive';
import type { EhGallerySummary } from '../stores/ehLibrary';

type InvokeArgs = Record<string, unknown>;
type MockHandler = (args: InvokeArgs) => unknown | Promise<unknown>;

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
    tags: [
      { name: storyTags[index % storyTags.length], category: '剧情' },
      { name: attributeTags[index % attributeTags.length], category: '属性' },
      { name: sceneTags[index % sceneTags.length], category: '场景' },
      { name: `角色${index % 9 + 1}`, category: '人物' },
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
    title: ['ラブプレグ', 'Garden Notes', '夏色アーカイブ', '星降る夜の記録', '午後のスケッチ', '冬のアルバム'][index % 6] + ` ${index + 1}`,
    category: ['doujinshi', 'manga', 'artist cg'][index % 3],
    artist: [`artist-${index % 8 + 1}`],
    group: [`circle-${index % 6 + 1}`],
    tags: ['sole female', ['schoolgirl', 'glasses', 'long hair', 'swimsuit'][index % 4], ['original', 'full color', 'story arc'][index % 3]],
    pages: 18 + index % 64,
    posted: `${2010 - Math.floor(index / 8)}-${String(12 - index % 12).padStart(2, '0')}-08`,
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
  title: 'ラブプレグ',
  category: 2,
  artist: ['ミサキ糖'],
  group: ['MISAKIX MEGAMIX'],
  tags: ['blowjob', 'impregnation', 'lactation', 'netorare', 'pregnant', 'vaginal birth', 'x-ray'],
  pages: 38,
  posted: '2011-12-08',
  cover_path: 'mock://eh-cover/440955',
  folder_path: 'D:\\MockEhLibrary\\440955-Gallery',
};

let favoriteCharacters = ['角色2', '角色5'];

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
      number: index + 1,
      subtitle: index % 2 ? `第 ${index + 1} 集副标题` : '',
      release_date: `${work.year}-${String((index % 12) + 1).padStart(2, '0')}`,
      video_path: `mock://video/${id}/${index + 1}`,
      cover_path: `mock://episode/${id}/${index + 1}`,
    })),
  };
}

function archiveDraft(dirPath: string): ArchiveDraft {
  return {
    title: dirPath.split(/[\\/]/).filter(Boolean).at(-1) || '待建档作品',
    search_aliases: [], studio: '', synopsis: '', characters: {}, episodes: 3,
    episode_list: Array.from({ length: 3 }, (_, index) => ({
      id: index + 1, subtitle: '', release_date: '', video_path: `${dirPath}\\episode-${index + 1}.mp4`,
      tags: { theme: [], attribute: [], scene: [] },
    })),
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
  initialize_media_library: () => ({ root_path: 'D:\\MockLibrary', source: 'previous', rebound_paths: 0, needs_binding: false }),
  bind_media_library: ({ rootPath }) => ({ root_path: String(rootPath || 'D:\\MockLibrary'), source: 'manual', rebound_paths: 0, needs_binding: false }),
  get_all_works_with_tags: () => structuredClone(works),
  get_tags: () => allTags(),
  get_studios: () => [...studios],
  get_favorite_characters: () => [...favoriteCharacters],
  set_character_favorite: ({ characterName, favorite }) => {
    const name = String(characterName || '');
    favoriteCharacters = Boolean(favorite) ? [...new Set([...favoriteCharacters, name])] : favoriteCharacters.filter((item) => item !== name);
    return [...favoriteCharacters];
  },
  get_work_detail: ({ workId }) => detail(Number(workId)),
  load_cover_cache: ({ coverPaths }) => (coverPaths as string[] || []).map((path, index) => [path, path.startsWith('/@fs/') ? path : coverData(path, index, path.includes('episode') || (path.includes('eh-page') && /\/(8|19)$/.test(path)))]),
  eh_delete_gallery_record: ({ gid }) => {
    ehGalleries = ehGalleries.filter((gallery) => gallery.gid !== Number(gid));
    return null;
  },
  eh_delete_gallery_folder: ({ gid }) => {
    ehGalleries = ehGalleries.filter((gallery) => gallery.gid !== Number(gid));
    return null;
  },
  list_unarchived_folders: () => structuredClone(unarchived),
  ensure_archive_data_dir: ({ dirPath }) => `${String(dirPath)}\\data`,
  inspect_archive_folder: ({ dirPath }) => archiveDraft(String(dirPath || 'D:\\MockLibrary\\Draft')),
  get_library_console_summary: () => ({ ...summary }),
  scan_library_changes: () => structuredClone(emptyScan),
  detect_duplicates: () => [],
  eh_get_library_overview: () => ({
    root_path: 'D:\\EhLibrary\\download', database_path: 'D:\\EhLibrary\\data\\export.db',
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
  eh_get_settings: () => structuredClone(ehSettings),
  eh_save_settings: ({ input }) => {
    const value = input as Record<string, string>;
    ehSettings = { root_path: value.rootPath, ipb_member_id: value.ipbMemberId, ipb_pass_hash: value.ipbPassHash, igneous: value.igneous };
    return structuredClone(ehSettings);
  },
  eh_get_gallery_pages: ({ gid }) => Array.from({ length: Number(gid) === 440955 ? 38 : 28 }, (_, index) => ({ index, path: `mock://eh-page/${gid}/${index + 1}`, width: index === 7 || index === 18 ? 1600 : 1000, height: index === 7 || index === 18 ? 1000 : 1500 })),
  eh_bind_local_library: ({ rootPath }) => ({ ...ehSettings, root_path: String(rootPath) }),
  eh_scan_local_library: () => ({ folders: 10, indexed: 10, created_meta: 9, created_cover: 9, removed_records: 0, skipped: 0, errors: [] }),
  eh_backup_database: () => undefined,
  eh_backup_data_package: () => undefined,
  eh_restore_database: () => undefined,
  open_folder: () => undefined,
  delete_work: ({ workId }) => {
    const index = works.findIndex((work) => work.id === Number(workId));
    if (index >= 0) works.splice(index, 1);
  },
};

export async function invokeBrowserMock<T>(command: string, args: InvokeArgs = {}): Promise<T> {
  const handler = handlers[command];
  if (!handler) throw new Error(`Web Mock 尚未实现命令: ${command}`);
  return await handler(args) as T;
}

export function listenBrowserMock<T>(_event: string, _handler: (payload: T) => void): () => void {
  return () => undefined;
}
