import { describe, expect, it } from 'vitest';
import { clampCrop, cropSource, zoomCrop } from './avatarCrop';

describe('circular avatar crop bounds', () => {
  it('starts with a centered circle covered by either landscape or portrait images', () => {
    expect(cropSource({ width: 800, height: 400 }, { zoom: 1, x: 0, y: 0 })).toEqual({ x: 200, y: 0, size: 400 });
    expect(cropSource({ width: 400, height: 800 }, { zoom: 1, x: 0, y: 0 })).toEqual({ x: 0, y: 200, size: 400 });
  });
  it('keeps the entire circle covered after dragging to all edges and changing scale', () => {
    for (const image of [{ width: 800, height: 400 }, { width: 400, height: 800 }, { width: 300, height: 300 }]) {
      for (const zoom of [.1, 1, 2.5, 5, 10]) for (const x of [-10000, 0, 10000]) for (const y of [-10000, 0, 10000]) {
        const source = cropSource(image, clampCrop(image, { zoom, x, y }));
        expect(source.x).toBeGreaterThanOrEqual(-.00001);
        expect(source.y).toBeGreaterThanOrEqual(-.00001);
        expect(source.x + source.size).toBeLessThanOrEqual(image.width + .00001);
        expect(source.y + source.size).toBeLessThanOrEqual(image.height + .00001);
      }
    }
  });
  it('retains the image point under the wheel cursor while zooming', () => {
    const image = { width: 800, height: 400 }, start = { zoom: 2, x: 20, y: -10 }, anchor = { x: 30, y: 20 };
    const next = zoomCrop(image, start, 3, anchor);
    expect((anchor.x - next.x) / next.zoom).toBeCloseTo((anchor.x - start.x) / start.zoom);
    expect((anchor.y - next.y) / next.zoom).toBeCloseTo((anchor.y - start.y) / start.zoom);
    const reset = zoomCrop(image, next, 1);
    expect(reset.y).toBeCloseTo(0);
  });
});
