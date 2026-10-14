/** 无放回的有界抽样；不排序或修改库列表，也不依赖库内当前筛选。 */
export function sampleItems<T>(items: readonly T[], count: number, random = Math.random): T[] {
  const indices = new Set<number>();
  const size = Math.min(items.length, Math.max(0, Math.floor(count)));
  // Floyd 抽样只循环 count 次，避免重复随机值导致死循环。
  for (let end = items.length - size; end < items.length; end += 1) {
    const candidate = Math.floor(random() * (end + 1));
    indices.add(indices.has(candidate) ? end : candidate);
  }
  return [...indices].map((index) => items[index]);
}

export interface DrawPool { seen: number[]; recent: number[] }
export function createDrawPool(): DrawPool { return { seen: [], recent: [] }; }

/** 等价于逐张洗牌：整轮无放回，跨轮避开最近 min(20, N/2) 部；不预先消耗候选牌。 */
export function pickNext<T>(items: readonly T[], pool: DrawPool, id: (item: T) => number, previous?: number, random = Math.random): T | undefined {
  const seen = new Set(pool.seen);
  const available = items.length > 1 ? items.filter((item) => id(item) !== previous) : items;
  const unseen = available.filter((item) => !seen.has(id(item)));
  const candidates = unseen.length ? unseen : available;
  const cooldown = Math.min(20, Math.floor(items.length / 2));
  const recent = new Set(cooldown ? pool.recent.slice(-cooldown) : []);
  const cooled = candidates.filter((item) => !recent.has(id(item)));
  // 库增删或极小库不能使抽取卡死；优先完成本轮，再放宽冷却。
  return sampleItems(cooled.length ? cooled : candidates, 1, random)[0];
}

/** 仅新牌真正展示时提交；失败、取消和迟到请求不消耗轮次。只保留 ID，不缓存图片。 */
export function recordDraw(pool: DrawPool, ids: readonly number[], selected: number): void {
  const live = new Set(ids);
  if (!live.has(selected)) return;
  const seen = pool.seen.filter((id) => live.has(id));
  pool.seen = [...(seen.includes(selected) ? [] : seen), selected];
  pool.recent = [...pool.recent.filter((id) => live.has(id) && id !== selected), selected].slice(-20);
}
