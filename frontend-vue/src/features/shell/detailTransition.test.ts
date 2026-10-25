import { describe, expect, it, vi } from 'vitest';
import { cancelDetailTransition, openCoverDetail, coverFlight, stableDetailPages, coverFrameKeyframes } from './detailTransition';

describe('shared cover navigation cancellation', () => {
  it('keeps card fills at the endpoints and leaves the traveling frame transparent', () => {
    const sourceBox = { x: 200, y: 100, width: 230, height: 320 }, targetBox = { x: 100, y: 80, width: 300, height: 400 };
    const source = { box: sourceBox, image: sourceBox, bitmap: sourceBox, radius: '13px', imageRadius: '8px', background: '#fff', border: '#ddd', shadow: 'none' };
    const target = { ...source, box: targetBox, background: '#eee', radius: '12px' };
    const frames = coverFrameKeyframes(source, target);
    expect(frames[0]!.backgroundColor).toBe('#fff');
    expect(frames.at(-1)!.backgroundColor).toBe('#eee');
    for (const frame of frames.slice(1, -1)) {
      expect(frame.backgroundColor).toBe('transparent');
      expect(frame.borderColor).toBe('transparent');
      expect(frame.transform).toBeUndefined();
      expect(frame.boxShadow).toBe('none');
    }
  });
  it('does not navigate after cancellation before source measurement, and allows the next entry', async () => {
    const obsolete = vi.fn().mockResolvedValue(undefined);
    const pending = openCoverDetail('download:-123', obsolete, { source: 'book', id: -123 });
    cancelDetailTransition();
    await pending;
    expect(obsolete).not.toHaveBeenCalled();
    expect(coverFlight.value).toBeNull();
    expect(stableDetailPages.value).toBe(false);
    const next = vi.fn().mockResolvedValue(undefined);
    await openCoverDetail('book-grid:123', next, { source: 'book', id: 123 });
    expect(next).toHaveBeenCalledOnce();
    cancelDetailTransition();
  });
  it('does not expose an uncropped card frame when a partial download cover begins entering', () => {
    const box = { x: 120, y: 700, width: 150, height: 200 };
    const source = { box, image: box, bitmap: box, radius: '6px', imageRadius: '0px', background: '#fff', border: '#ddd', shadow: 'none', sourceClip: { x: 100, y: 300, width: 400, height: 500 } };
    const target = { ...source, sourceClip: undefined };
    const frames = coverFrameKeyframes(source, target);
    expect(frames[0]!.opacity).toBe(0);
    expect(frames.at(-1)!.opacity).toBe(1);
    const returning = coverFrameKeyframes(target, source);
    expect(returning[0]!.opacity).toBe(1);
    expect(returning.at(-1)!.opacity).toBe(0);
  });
});
