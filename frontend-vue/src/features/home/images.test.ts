import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeDrawImages, prepareDrawImages } from './images';
import type { DrawSelection } from '../../stores/home';

afterEach(() => vi.unstubAllGlobals());

describe('draw image preparation', () => {
  it('prepares portrait, spread and square ratios before revealing a candidate', async () => {
    const release: Array<() => void> = [];
    const sizes: Record<string, [number, number]> = { cover: [800, 1200], portrait: [800, 1200], spread: [1200, 800], square: [800, 800] };
    vi.stubGlobal('Image', class {
      src = ''; decoding = '';
      get naturalWidth() { return sizes[this.src][0]; }
      get naturalHeight() { return sizes[this.src][1]; }
      decode(): Promise<void> { return new Promise(done => release.push(done)); }
    });
    const selection: DrawSelection = { id: 1, title: '', cover: 'cover', previews: ['portrait', 'spread', 'square'].map(image => ({ key: image, label: '', image })) };
    const pending = prepareDrawImages(selection);
    expect(selection.previews.map(preview => preview.aspectRatio)).toEqual([undefined, undefined, undefined]);
    release.forEach(done => done());
    await pending;
    expect(selection.previews.map(preview => preview.aspectRatio)).toEqual([2 / 3, 1.5, 1]);
  });

  it('keeps failed and zero-size previews on the existing fallback without invalid ratios', async () => {
    vi.stubGlobal('Image', class {
      src = ''; decoding = ''; naturalWidth = 0; naturalHeight = 0;
      decode(): Promise<void> { return this.src === 'bad' ? Promise.reject(new Error('bad')) : Promise.resolve(); }
    });
    const selection: DrawSelection = { id: 1, title: '', cover: '', previews: ['bad', 'empty'].map(image => ({ key: image, label: '', image })) };
    await expect(prepareDrawImages(selection)).resolves.toBeUndefined();
    expect(selection.previews.every(preview => preview.aspectRatio === undefined)).toBe(true);
  });

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
