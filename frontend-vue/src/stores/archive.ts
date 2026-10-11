import { defineStore } from 'pinia';
import { nextTick } from 'vue';
import { archiveApi } from '../api/commands/archive';
import { libraryApi } from '../api/commands/library';
import { systemApi } from '../api/commands/system';
import { copyText } from '../runtime/clipboard';
import { playerCommands } from '../features/player/commands';
import type { ArchiveDraft, ArchiveEpisode, ArchiveSaveInput } from '../api/contracts/archive';
import type { UnarchivedItem } from '../api/contracts/library';
import { useLibraryStore } from './library';
import { useLibraryConsoleStore } from './libraryConsole';
import { useNavigationStore } from './navigation';

export type { UnarchivedItem } from '../api/contracts/library';

type MessageKind = 'info' | 'err';
interface UiMessage { kind: MessageKind; text: string }

const indexLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
const collator = new Intl.Collator('zh-CN-u-co-pinyin', { numeric: true, sensitivity: 'base' });
const pinyinBoundaries = '阿八嚓哒妸发旮哈讥咔垃妈拿哦啪期然撒塌挖昔压匝';
const pinyinBoundaryLetters = 'ABCDEFGHJKLMNOPQRSTWXYZ';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstIndexableCharacter(title: string): string {
  const normalized = String(title || '').normalize('NFKC').trim();
  for (const character of normalized) {
    if (/[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(character)) return character;
  }
  return '';
}

function kanaIndexLetter(character: string): string {
  const groups: Record<string, string> = {
    A: 'あぁアァ', E: 'えぇエェ', I: 'いぃイィ', O: 'おぉオォ', U: 'うぅウゥ', B: 'ばびぶべぼバビブベボ', C: 'ちチ', D: 'だでどダデド',
    F: 'ふフ', G: 'がぎぐげごガギグゲゴ', H: 'はひへほハヒヘホ', J: 'じぢジヂ', K: 'かきくけこゕゖカキクケコヵヶ', M: 'まみむめもマミムメモ',
    N: 'なにぬねのんナニヌネノン', P: 'ぱぴぷぺぽパピプペポ', R: 'らりるれろラリルレロ', S: 'さしすせそサシスセソ',
    T: 'たつてとっタツテトッ', V: 'ゔヴ', W: 'わをゐゑゎワヲヰヱヮ', Y: 'やゆよゃゅょヤユヨャュョ', Z: 'ざずぜぞづザズゼゾヅ',
  };
  return Object.keys(groups).find((letter) => groups[letter].includes(character)) || '';
}

export function getUnarchivedIndexLetter(title: string): string {
  const character = firstIndexableCharacter(title);
  if (!character || /[0-9]/.test(character)) return '#';
  if (/[A-Za-z]/.test(character)) return character.toUpperCase();
  if (/[\u3040-\u30ff]/.test(character)) return kanaIndexLetter(character) || '#';
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(character)) {
    for (let index = pinyinBoundaries.length - 1; index >= 0; index -= 1) {
      if (collator.compare(character, pinyinBoundaries[index]) >= 0) return pinyinBoundaryLetters[index];
    }
  }
  return '#';
}

export function summarizeUnarchivedReasons(item: UnarchivedItem): string[] {
  const reasons = item.missing_reasons || [];
  const summary: string[] = [];
  const add = (text: string) => { if (!summary.includes(text)) summary.push(text); };
  if (!item.has_data_dir) add('缺少 data 文件夹');
  if (!item.has_meta_json) add('缺少 meta.json');
  if (reasons.some((reason) => /视频.*编号|编号.*视频/.test(reason))) add('视频编号有误');
  if (reasons.includes('缺少主封面')) add('缺少主封面');
  if (reasons.some((reason) => /^缺少第\d+集封面$/.test(reason))) add('集数封面不齐全');
  if (item.has_meta_json && reasons.some((reason) => !/视频.*编号|编号.*视频/.test(reason) && reason !== '缺少主封面' && !/^缺少第\d+集封面$/.test(reason))) add('meta.json 不完整');
  return summary;
}

export function restoredUnarchivedScrollTop(
  savedTop: number,
  maxTop: number,
  focusedCardTop?: number,
  focusedCardViewportOffset = 0,
): number {
  const target = Number.isFinite(focusedCardTop)
    ? Number(focusedCardTop) - Math.max(0, focusedCardViewportOffset)
    : savedTop;
  return Math.max(0, Math.min(Math.max(0, maxTop), Math.max(0, target || 0)));
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function splitTags(value: string): string[] {
  return String(value || '').split(/[,，、;；]/).map((tag) => tag.trim()).filter(Boolean);
}

export const useArchiveStore = defineStore('archive', {
  state: () => ({
    unarchivedScrollTop: 0,
    unarchivedFocusPath: '',
    unarchivedFocusOffset: 0,
    unarchivedPath: 'D:\\HAnime',
    folders: [] as UnarchivedItem[],
    unarchivedLoading: false,
    unarchivedError: '',
    activeIndex: '',
    dirPath: '',
    title: '',
    searchAliasesText: '',
    studio: '',
    charactersText: '',
    synopsis: '',
    jsonText: '',
    message: null as UiMessage | null,
    jsonMessage: null as UiMessage | null,
    refreshing: false,
    copied: false,
    mainCoverPreview: '',
    draft: null as ArchiveDraft | null,
    coverData: null as string | null,
    episodeCoverData: {} as Record<number, string>,
    dataPath: '',
    focusEpisode: null as number | null,
  }),

  getters: {
    availableIndexes: (state): Set<string> => new Set(state.folders.map((item) => item.index_letter || '#')),
    groupedFolders: (state): Array<{ letter: string; items: UnarchivedItem[] }> => indexLetters
      .map((letter) => ({ letter, items: state.folders.filter((item) => item.index_letter === letter) }))
      .filter((group) => group.items.length),
    currentDraft(state): ArchiveDraft | null { return state.draft; },
    episodes(): ArchiveEpisode[] { return this.draft?.episode_list || []; },
  },

  actions: {
    showMessage(kind: MessageKind, text: string): void { this.message = { kind, text }; },
    showJsonMessage(kind: MessageKind, text: string): void { this.jsonMessage = { kind, text }; },

    async openUnarchivedPage(): Promise<void> {
      const navigation = useNavigationStore();
      const returning = navigation.activePage === 'page-archive';
      if (!returning) {
        this.unarchivedScrollTop = 0;
        this.unarchivedFocusPath = '';
        this.unarchivedFocusOffset = 0;
      }
      this.unarchivedPath = useLibraryConsoleStore().mediaPath.trim() || 'D:\\HAnime';
      navigation.showPage('page-unarchived');
      await this.loadUnarchivedFolders();
    },

    async loadUnarchivedFolders(): Promise<void> {
      const path = this.unarchivedPath.trim();
      if (!path) return;
      this.unarchivedLoading = true;
      this.unarchivedError = '';
      try {
        const folders = await libraryApi.listUnarchivedFolders(path);
        folders.forEach((item) => { item.index_letter = getUnarchivedIndexLetter(item.title); });
        folders.sort((left, right) => indexLetters.indexOf(left.index_letter || '#') - indexLetters.indexOf(right.index_letter || '#') || collator.compare(left.title, right.title));
        this.folders = folders;
      } catch (error) {
        this.folders = [];
        this.unarchivedError = `扫描失败: ${errorText(error)}`;
      } finally {
        this.unarchivedLoading = false;
      }
    },

    setActiveIndex(letter: string): void {
      this.activeIndex = letter;
    },

    async openArchiveAssistant(dirPath = '', focusEpisode?: number | null): Promise<void> {
      this.draft = null;
      this.coverData = null;
      this.episodeCoverData = {};
      this.dataPath = '';
      this.focusEpisode = focusEpisode || null;
      this.dirPath = dirPath;
      this.title = '';
      this.searchAliasesText = '';
      this.studio = '';
      this.charactersText = '';
      this.synopsis = '';
      this.jsonText = '';
      this.message = null;
      this.jsonMessage = null;
      this.mainCoverPreview = '';
      useNavigationStore().showPage('page-archive');
      if (!dirPath) return;
      try {
        this.dataPath = await archiveApi.ensureDataDir(dirPath);
        await this.loadArchiveDraft();
      } catch (error) {
        this.showMessage('err', `准备 data 文件夹失败: ${errorText(error)}`);
      }
    },

    async loadArchiveDraft(): Promise<void> {
      const dirPath = this.dirPath.trim();
      if (!dirPath) { this.showMessage('err', '请先填写作品目录'); return; }
      try {
        const draft = await archiveApi.inspectFolder(dirPath);
        this.draft = draft;
        this.title = draft.title || '';
        this.searchAliasesText = (draft.search_aliases || []).join('\n');
        this.studio = draft.studio || '';
        this.synopsis = draft.synopsis || '';
        this.charactersText = Object.keys(draft.characters || {}).sort((left, right) => Number(left) - Number(right)).map((key) => draft.characters[key]).filter(Boolean).join('\n');
        const coverPaths = [draft.cover_path, ...draft.episode_list.map((episode) => episode.cover_path)].filter((path): path is string => Boolean(path));
        const library = useLibraryStore();
        await library.loadCovers(coverPaths);
        this.mainCoverPreview = library.coverUrl(draft.cover_path);
        this.showMessage('info', `已读取目录，发现 ${draft.episodes} 个视频`);
        await nextTick();
      } catch (error) {
        this.showMessage('err', `读取失败: ${errorText(error)}`);
      }
    },

    episodePreview(episode: ArchiveEpisode): string {
      return this.episodeCoverData[episode.id] || useLibraryStore().coverUrl(episode.cover_path || undefined);
    },

    async setMainCover(file?: File): Promise<void> {
      if (!file) return;
      const dataUrl = await fileToDataUrl(file);
      this.coverData = dataUrl;
      this.mainCoverPreview = dataUrl;
    },

    async setEpisodeCover(episodeId: number, file?: File): Promise<void> {
      if (!file) return;
      this.episodeCoverData[episodeId] = await fileToDataUrl(file);
    },

    async playEpisodeForCover(episodeId: number): Promise<void> {
      const episode = this.episodes.find((item) => Number(item.id) === Number(episodeId));
      if (!episode) { this.showMessage('err', '请先读取目录'); return; }
      await playerCommands.openPlayerWithEpisode({ id: episode.id, number: episode.id, video_path: episode.video_path }, `${this.draft?.title || '建档'} / 第${episode.id}集取帧`, 'archive');
    },

    collectArchiveInput(): ArchiveSaveInput {
      if (!this.draft) throw new Error('请先读取目录');
      const characters: Record<string, string> = {};
      this.charactersText.split(/\r?\n/).map((name) => name.trim()).filter(Boolean).forEach((name, index) => { characters[String(index + 1)] = name; });
      return {
        dir_path: this.dirPath.trim(),
        title: this.title.trim(),
        search_aliases: [...new Set(this.searchAliasesText.split(/\r?\n/).map((alias) => alias.trim()).filter(Boolean))],
        studio: this.studio.trim(),
        synopsis: this.synopsis.trim(),
        characters,
        episode_list: this.episodes.map((episode) => ({ ...episode, subtitle: episode.subtitle || '', release_date: episode.release_date || '', tags: {
          theme: splitTags(Array.isArray(episode.tags.theme) ? episode.tags.theme.join(',') : String(episode.tags.theme || '')),
          attribute: splitTags(Array.isArray(episode.tags.attribute) ? episode.tags.attribute.join(',') : String(episode.tags.attribute || '')),
          scene: splitTags(Array.isArray(episode.tags.scene) ? episode.tags.scene.join(',') : String(episode.tags.scene || '')),
        } })),
        cover_data: this.coverData,
      };
    },

    async saveArchive(shouldImport: boolean): Promise<void> {
      try {
        const input = this.collectArchiveInput();
        if (!this.title.trim()) { this.showMessage('err', '标题不能为空'); return; }
        const coverInputs = Object.entries(this.episodeCoverData).map(([id, image_data]) => ({ id: Number.parseInt(id, 10), image_data }));
        if (coverInputs.length) await archiveApi.saveEpisodeCovers(this.dirPath.trim(), coverInputs);
        const outPath = await archiveApi.saveDraft(input);
        const library = useLibraryStore();
        library.clearArchiveCoverCaches(this.dirPath.trim(), this.episodes);
        if (shouldImport) {
          await libraryApi.importWork(this.dirPath.trim());
          await library.refreshHome({ resetFilters: true, clearCoverCache: true });
        }
        this.showMessage('info', shouldImport ? `已保存并导入: ${outPath}` : `已保存: ${outPath}`);
      } catch (error) {
        this.showMessage('err', `保存失败: ${errorText(error)}`);
      }
    },

    async savePastedJson(): Promise<void> {
      const dirPath = this.dirPath.trim();
      const jsonText = this.jsonText.trim();
      if (!dirPath) { this.showJsonMessage('err', '请先填写作品目录'); return; }
      if (!jsonText) { this.showJsonMessage('err', '请先粘贴 meta.json'); return; }
      try { JSON.parse(jsonText); } catch (error) { this.showJsonMessage('err', `JSON 格式错误: ${errorText(error)}`); return; }
      try {
        const outPath = await archiveApi.saveJson(dirPath, jsonText);
        await this.loadArchiveDraft();
        try {
          await libraryApi.importWork(dirPath);
          await useLibraryStore().refreshHome({ resetFilters: true, clearCoverCache: true });
          this.showJsonMessage('info', `已保存并导入主库: ${outPath}`);
        } catch (importError) {
          this.showJsonMessage('info', `已保存: ${outPath}；暂未导入主库: ${errorText(importError)}`);
        }
      } catch (error) {
        this.showJsonMessage('err', `保存失败: ${errorText(error)}`);
      }
    },

    async openWorkFolder(): Promise<void> {
      if (this.dirPath.trim()) await systemApi.openFolder(this.dirPath.trim());
    },

    async refreshDraft(): Promise<void> {
      if (!this.dirPath.trim() || this.refreshing) return;
      this.refreshing = true;
      try {
        if (this.draft) {
          const library = useLibraryStore();
          if (this.draft.cover_path) delete library.coverCache[this.draft.cover_path];
          this.draft.episode_list.forEach((episode) => { if (episode.cover_path) delete library.coverCache[episode.cover_path]; });
          library.clearArchiveCoverCaches(this.dirPath.trim(), this.draft.episode_list);
        }
        this.coverData = null;
        this.episodeCoverData = {};
        this.jsonText = '';
        this.jsonMessage = null;
        this.mainCoverPreview = '';
        await this.loadArchiveDraft();
      } finally {
        this.refreshing = false;
      }
    },

    async copyDataPath(): Promise<void> {
      if (!this.dirPath.trim()) return;
      const dataPath = this.dataPath || `${this.dirPath.replace(/[\\/]+$/, '')}\\data`;
      try {
        await copyText(dataPath);
        this.copied = true;
        window.setTimeout(() => { this.copied = false; }, 1200);
      } catch (error) {
        this.showMessage('err', `复制 data 路径失败: ${errorText(error)}`);
      }
    },
  },
});

export { indexLetters as unarchivedIndexLetters };
