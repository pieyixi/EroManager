import type { DrawSelection } from '../../stores/home';

/** 在翻牌前完成解码，避免大图首次绘制与 3D 动画争抢一帧；不保留跨抽卡缓存。 */
export async function decodeDrawImages(urls: string[], decoded?: (url: string, ratio: number) => void): Promise<void> {
  await Promise.all([...new Set(urls.filter(Boolean))].map(async (url) => {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    try {
      await image.decode();
      const ratio = image.naturalWidth / image.naturalHeight;
      if (ratio > 0 && Number.isFinite(ratio)) decoded?.(url, ratio);
    } catch { /* 无效图片由卡片的原有占位状态处理。 */ }
  }));
}

/** 比例随本次候选一起准备，换图的第一帧直接使用真实尺寸，不等 DOM 的 load 再纠正。 */
export function prepareDrawImages(selection: DrawSelection): Promise<void> {
  return decodeDrawImages([selection.cover, ...selection.previews.map(preview => preview.image)], (url, ratio) => {
    for (const preview of selection.previews) if (preview.image === url) preview.aspectRatio = ratio;
  });
}
