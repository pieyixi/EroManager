import { describe, expect, it } from 'vitest';
import { createDrawPool, pickNext, recordDraw, sampleItems } from './random';

describe('bounded home sampling', () => {
  it('handles empty and short libraries without duplicates or mutation', () => {
    const items = [1, 2];
    expect(sampleItems([], 3)).toEqual([]);
    expect(sampleItems(items, 3, () => 0)).toEqual([1, 2]);
    expect(items).toEqual([1, 2]);
    expect(sampleItems(items, 0)).toEqual([]);
  });
  it('terminates in three calls even when every random result repeats', () => {
    let calls = 0;
    const result = sampleItems(Array.from({ length: 100000 }, (_, i) => i), 3, () => { calls += 1; return 0; });
    expect(calls).toBe(3);
    expect(new Set(result).size).toBe(3);
  });
  it('can select the last entry and keeps negative source identities', () => {
    expect(sampleItems([1, 2, 3], 1, () => 0.99999)).toEqual([3]);
    expect(pickNext([{ id: 7 }, { id: -7 }], createDrawPool(), (item) => item.id, 7)?.id).toBe(-7);
    expect(pickNext([{ id: -7 }], createDrawPool(), (item) => item.id, -7)?.id).toBe(-7);
  });
  it('completes every cycle without repeats and respects cross-cycle cooldown', () => {
    for (const size of [1, 2, 3, 6, 50, 275]) {
      const items = Array.from({ length: size }, (_, i) => i - 2);
      for (const random of [() => 0, () => .99999, Math.random]) {
        const pool = createDrawPool();
        const history: number[] = [];
        for (let index = 0; index < size * 8; index += 1) {
          const selected = pickNext(items, pool, (id) => id, history.at(-1), random)!;
          const cooldown = Math.min(20, Math.floor(size / 2));
          expect(cooldown ? history.slice(-cooldown) : []).not.toContain(selected);
          recordDraw(pool, items, selected);
          history.push(selected);
          if (history.length % size === 0) expect(new Set(history.slice(-size)).size).toBe(size);
          expect(pool.recent.length).toBeLessThanOrEqual(20);
          expect(pool.seen.length).toBeLessThanOrEqual(size);
        }
      }
    }
  });
  it('does not consume a candidate before commit and handles additions/removals/empty pools', () => {
    const pool = createDrawPool();
    expect(pickNext([], pool, Number)).toBeUndefined();
    expect(pickNext([7, -7], pool, Number, undefined, () => 0)).toBe(7);
    expect(pool).toEqual({ seen: [], recent: [] });
    recordDraw(pool, [7, -7], 7);
    expect(pickNext([7, -7, 8], pool, Number, 7, () => .99999)).toBe(8);
    recordDraw(pool, [-7, 8], 8);
    expect(pool.seen).toEqual([8]);
    expect(pool.recent).toEqual([8]);
    expect(pickNext([-7, 8], pool, Number, 8)).toBe(-7);
    recordDraw(pool, [], -7);
    expect(pool.seen).toEqual([8]);
  });
});
