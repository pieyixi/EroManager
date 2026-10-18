import { describe, expect, it, vi } from 'vitest';
import { cancelDetailTransition, openCoverDetail, coverFlight, stableDetailPages } from './detailTransition';

describe('shared cover navigation cancellation', () => {
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
});
