import { describe, expect, it } from 'vitest';
import { bitmapClip, coverBitmap, coverRaster, intersectCoverBox } from './coverGeometry';

describe('cover bitmap and visible crop', () => {
  it('clips partial cards to the scroll viewport without shrinking the full image geometry', () => {
    const viewport = { x: 100, y: 300, width: 400, height: 500 };
    expect(intersectCoverBox({ x: 120, y: 700, width: 150, height: 200 }, viewport)).toEqual({ x: 120, y: 700, width: 150, height: 100 });
    expect(intersectCoverBox({ x: 120, y: 200, width: 150, height: 200 }, viewport)).toEqual({ x: 120, y: 300, width: 150, height: 100 });
  });
  it.each([[360, 480], [640, 360], [300, 700]])('preserves %i x %i artwork proportion across unequal cover frames', (width, height) => {
    const start = { x: 200, y: 100, width: 222, height: 311 };
    const end = { x: 100, y: 80, width: 298, height: 398 };
    const from = coverBitmap(start, width, height), to = coverBitmap(end, width, height);
    expect(from.width / from.height).toBeCloseTo(width / height, 10);
    expect(to.width / to.height).toBeCloseTo(width / height, 10);
    expect(from.width / to.width).toBeCloseTo(from.height / to.height, 10);
    const clip = bitmapClip(start, from, to, '8px').match(/inset\((.*?) round/)!;
    const [top, right, bottom, left] = clip[1]!.split(' ').map(parseFloat);
    const scale = from.width / to.width;
    expect(from.x + left! * scale).toBeCloseTo(start.x);
    expect(from.y + top! * scale).toBeCloseTo(start.y);
    expect((to.width - left! - right!) * scale).toBeCloseTo(start.width);
    expect((to.height - top! - bottom!) * scale).toBeCloseTo(start.height);
  });
  it('honors a non-centered crop and handles unavailable images', () => {
    const viewport = { x: 10, y: 20, width: 100, height: 200 };
    expect(coverBitmap(viewport, 400, 200, 'cover', '0% 100%')).toEqual({ x: 10, y: 20, width: 400, height: 200 });
    expect(coverBitmap(viewport, 0, 0)).toEqual(viewport);
  });
  it('keeps the larger bitmap raster in both navigation directions', () => {
    const large = { x: 100, y: 80, width: 300, height: 400 }, small = { x: 20, y: 30, width: 150, height: 200 };
    expect(coverRaster(large, small)).toEqual(coverRaster(small, large));
    expect(coverRaster(large, small)).toEqual({ x: 0, y: 0, width: 300, height: 400 });
  });
});
