/** 在翻牌前完成解码，避免大图首次绘制与 3D 动画争抢一帧；不保留跨抽卡缓存。 */
export async function decodeDrawImages(urls: string[]): Promise<void> {
  await Promise.all([...new Set(urls.filter(Boolean))].map(async (url) => {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    try { await image.decode(); } catch { /* 无效图片由卡片的原有占位状态处理。 */ }
  }));
}
