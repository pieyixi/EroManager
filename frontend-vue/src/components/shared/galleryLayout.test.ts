import { describe, expect, it } from 'vitest';
import { galleryLayout } from './galleryLayout';

describe('expanding preview placement', () => {
  it.each([240, 420, 720])('keeps every expanded image and its displaced neighbors in bounds at %ipx', width => {
    for (let index = 0; index < 12; index++) {
      const layout = galleryLayout(width, 12, index);
      const boxes = layout.tiles.map(tile => ({ x: tile.x, y: tile.y, w: layout.tileWidth * tile.scale, h: layout.tileHeight * tile.scale }));
      for (let a = 0; a < boxes.length; a++) {
        const box = boxes[a]!;
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.w).toBeLessThanOrEqual(width + .001);
        expect(box.y + box.h).toBeLessThanOrEqual(layout.height + .001);
        for (const other of boxes.slice(a + 1)) {
          const overlap = Math.min(box.x+box.w, other.x+other.w)-Math.max(box.x,other.x) > .01
            && Math.min(box.y+box.h,other.y+other.h)-Math.max(box.y,other.y) > .01;
          expect(overlap).toBe(false);
        }
      }
    }
  });
  it('keeps the pointed image near its current row while rearranging the rest', () => {
    const layout = galleryLayout(720, 8, 2, { row: 3, column: 2 });
    expect(layout.tiles[2]?.row).toBe(3); expect(layout.tiles[2]?.column).toBe(1);
    expect(layout.tiles[2]?.scale).toBeGreaterThan(2);
    expect(galleryLayout(720, 0, null).height).toBe(0);
  });
});
