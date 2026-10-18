export type PaginationItem = number | 'ellipsis';

export function paginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  const total = Math.max(1, Math.floor(totalPages) || 1);
  const current = Math.max(1, Math.min(total, Math.floor(currentPage) || 1));
  const pages = [...new Set([1, ...Array.from({ length: 5 }, (_, i) => current + i - 2), total])]
    .filter(page => page >= 1 && page <= total).sort((a, b) => a - b);
  const items: PaginationItem[] = [];
  for (const page of pages) {
    const previous = items.at(-1);
    if (typeof previous === 'number' && page - previous > 1) items.push('ellipsis');
    items.push(page);
  }
  return items;
}
