import type { EhCategoryMetric } from '../../api/contracts/settings';

export function sizeParts(bytes: number): { value: string; unit: string } {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, Number.isFinite(bytes) ? bytes : 0), index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return { value: index < 3 ? String(Math.round(value)) : value.toFixed(value >= 100 ? 0 : 1), unit: units[index] };
}

export function averageSize(bytes: number, count: number): string {
  if (count <= 0) return '—';
  const size = sizeParts(bytes);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  return `${(Math.max(0, Number.isFinite(bytes) ? bytes : 0) / 1024 ** units.indexOf(size.unit) / count).toFixed(2)} ${size.unit}`;
}

/** 百分比以分类实际计数为分母；不假定后端只有参考图里的六个分类。 */
export function categoryDistribution(categories: EhCategoryMetric[]) {
  const positive = categories.filter(item => item.count > 0).sort((left, right) => right.count - left.count);
  const total = positive.reduce((sum, item) => sum + item.count, 0);
  return positive.map((item, index) => ({ ...item, percent: item.count / total * 100, color: `var(--stats-c${index % 10 + 1})` }));
}
