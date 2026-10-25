export interface GalleryAnchor { row: number; column: number }
export interface GalleryTile extends GalleryAnchor { x: number; y: number; scale: number }

/** 放大项先占据原位置附近的格子，其余项顺序让位；只计算目标，不逐帧排版。 */
export function galleryLayout(width: number, count: number, selected: number | null, anchor?: GalleryAnchor) {
  const columns = width < 260 ? 1 : width < 520 ? 2 : 3;
  const gap = 10;
  const tileWidth = Math.max(1, (width - gap * (columns - 1)) / columns);
  const tileHeight = tileWidth * 2 / 3;
  const span = Math.min(2, columns);
  const occupied = new Set<number>();
  const tiles: GalleryTile[] = [];
  const place = (row: number, column: number, scale = 1): GalleryTile => ({ row, column, x: column * (tileWidth + gap), y: row * (tileHeight + gap), scale });
  if (selected !== null && selected >= 0 && selected < count) {
    const row = Math.max(0, anchor?.row ?? Math.floor(selected / columns));
    const column = Math.max(0, Math.min(columns - span, anchor?.column ?? selected % columns));
    tiles[selected] = place(row, column, (tileWidth * span + gap * (span - 1)) / tileWidth);
    for (let y = 0; y < span; y++) for (let x = 0; x < span; x++) occupied.add((row + y) * columns + column + x);
  }
  let cell = 0;
  for (let index = 0; index < count; index++) {
    if (tiles[index]) continue;
    while (occupied.has(cell)) cell++;
    tiles[index] = place(Math.floor(cell / columns), cell % columns);
    occupied.add(cell++);
  }
  return { columns, tileWidth, tileHeight, tiles, height: Math.max(0, ...tiles.map(tile => tile.y + tileHeight * tile.scale)) };
}
