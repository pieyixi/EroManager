import { describe, expect, it } from 'vitest';
import { averageSize, categoryDistribution, sizeParts } from './statistics';

describe('library statistics', () => {
  it('separates actual capacity units and derives average sizes without zero division', () => {
    const bytes = 280 * 1024 ** 3;
    expect(sizeParts(bytes)).toEqual({ value: '280', unit: 'GB' });
    expect(averageSize(bytes, 302)).toBe('0.93 GB');
    expect(averageSize(bytes, 696)).toBe('0.40 GB');
    expect(averageSize(0, 0)).toBe('—');
    expect(sizeParts(Number.NaN)).toEqual({ value: '0', unit: 'B' });
  });
  it('uses actual positive categories without inventing categories or exceeding 100 percent', () => {
    const items = categoryDistribution([
      { category: 1, label: 'Doujinshi', count: 143, bytes: 1 },
      { category: 2, label: 'Manga', count: 35, bytes: 1 },
      { category: 3, label: 'Empty', count: 0, bytes: 0 },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].percent).toBeCloseTo(143 / 178 * 100);
    expect(items.reduce((sum, item) => sum + item.percent, 0)).toBeCloseTo(100);
    expect(categoryDistribution([])).toEqual([]);
  });
});
