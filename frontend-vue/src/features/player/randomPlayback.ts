import { accountScope } from '../../api/accountContext';
import { libraryApi } from '../../api/commands/library';
import type { PlayerEpisode, WorkDetail, WorkSummary } from '../../api/contracts/library';
import { useLibraryStore } from '../../stores/library';
import { usePlayerRandomStore } from '../../stores/playerRandom';
import { pickNext } from '../home/random';
import { orderedPlayerEpisodes } from './model';

/** 只在当前作品末集之后挑下一部；失败/空作品仅在本次有界尝试中跳过，不消耗随机轮次。 */
export async function playRandomWork(options: {
  valid(): boolean;
  load(detail: WorkDetail, episode: PlayerEpisode): Promise<boolean>;
  report(text: string): void;
}): Promise<void> {
  const library = useLibraryStore(), random = usePlayerRandomStore();
  const current = library.currentDetail?.work.id;
  const owner = accountScope();
  const valid = () => owner === accountScope() && options.valid();
  if (current === undefined || !valid()) return;
  await random.restore();
  if (!valid() || !random.loaded) return;
  const roster = library.works.filter(work => work.episode_count > 0);
  const ids = roster.map(work => work.id);
  await random.rememberCurrent(ids, current);
  if (!valid()) return;
  const attempted = new Set<number>();
  while (valid()) {
    const candidate: WorkSummary | undefined = pickNext(roster.filter(work => !attempted.has(work.id)), random.pool, work => work.id, current);
    if (!candidate || candidate.id === current) break;
    attempted.add(candidate.id);
    let detail: WorkDetail;
    try { detail = await libraryApi.getWorkDetail(candidate.id); }
    catch { continue; }
    if (!valid()) return;
    if (!library.works.some(work => work.id === candidate.id) || detail?.work.id !== candidate.id) continue;
    const episodes = orderedPlayerEpisodes(detail.episodes);
    if (!episodes.length) continue;
    await library.loadCovers([detail.work.cover_path, ...episodes.map(episode => episode.cover_path)].filter((path): path is string => Boolean(path)));
    if (!valid()) return;
    if (!library.works.some(work => work.id === candidate.id)) continue;
    // load 负责原生首帧和离页保护；成功后才提交，不让取消或失败消耗候选作品。
    if (await options.load({ ...detail, episodes }, episodes[0]) && owner === accountScope()) {
      try { await random.commit(library.works.filter(work => work.episode_count > 0).map(work => work.id), candidate.id); }
      catch { if (owner === accountScope()) options.report('随机播放记录未保存，本次仍可继续播放'); }
    }
    return;
  }
  if (valid()) options.report('没有其他可播放作品，随机连播已停止');
}
