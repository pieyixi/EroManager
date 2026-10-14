import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeDrawImages } from './images';

afterEach(() => vi.unstubAllGlobals());

describe('draw image preparation', () => {
  it('decodes distinct nonempty images in parallel without retaining them', async () => {
    const seen: string[] = [];
    const release: Array<() => void> = [];
    vi.stubGlobal('Image', class {
      src = '';
      decoding = '';
      decode(): Promise<void> { seen.push(this.src); return new Promise((done) => release.push(done)); }
    });
    let finished = false;
    const pending = decodeDrawImages(['cover', '', 'page', 'cover']).then(() => { finished = true; });
    expect(seen).toEqual(['cover', 'page']);
    expect(finished).toBe(false);
    release.forEach((done) => done());
    await pending;
    expect(finished).toBe(true);
  });

  it('leaves malformed-image handling to the existing fallback rather than locking the draw', async () => {
    vi.stubGlobal('Image', class { src = ''; decoding = ''; decode(): Promise<void> { return Promise.reject(new Error('bad image')); } });
    await expect(decodeDrawImages(['bad'])).resolves.toBeUndefined();
    await expect(decodeDrawImages([])).resolves.toBeUndefined();
  });
});
