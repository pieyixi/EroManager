export interface CoverBox { x: number; y: number; width: number; height: number }

export function intersectCoverBox(box: CoverBox, viewport: CoverBox): CoverBox {
  const x = Math.max(box.x, viewport.x), y = Math.max(box.y, viewport.y);
  return { x, y, width: Math.max(0, Math.min(box.x + box.width, viewport.x + viewport.width) - x),
    height: Math.max(0, Math.min(box.y + box.height, viewport.y + viewport.height) - y) };
}

/** 保留完整位图的等比尺寸；可见裁切窗口单独记录，不能把已裁切的矩形当作位图缩放。 */
export function coverBitmap(viewport: CoverBox, naturalWidth: number, naturalHeight: number, fit = 'cover', position = '50% 50%'): CoverBox {
  if (!(naturalWidth > 0 && naturalHeight > 0) || !['cover', 'contain', 'none', 'scale-down'].includes(fit)) return { ...viewport };
  let scale = fit === 'none' ? 1 : (fit === 'cover' ? Math.max : Math.min)(viewport.width / naturalWidth, viewport.height / naturalHeight);
  if (fit === 'scale-down') scale = Math.min(1, scale);
  const width = naturalWidth * scale, height = naturalHeight * scale;
  const parts = position.split(/\s+/);
  const offset = (value: string, space: number): number => value.endsWith('%') ? space * Number.parseFloat(value) / 100 : Number.parseFloat(value) || 0;
  return { x: viewport.x + offset(parts[0] || '50%', viewport.width - width), y: viewport.y + offset(parts[1] || '50%', viewport.height - height), width, height };
}

export function flightTransform(from: CoverBox, to: CoverBox): string {
  return `translate3d(${from.x}px, ${from.y}px, 0) scale(${from.width / to.width}, ${from.height / to.height})`;
}

/** 按较大端绘制，返回较小卡片时也不能先降清晰度、再放大回起点。 */
export function coverRaster(from: CoverBox, to: CoverBox): CoverBox {
  return { x: 0, y: 0, width: Math.max(from.width, to.width), height: Math.max(from.height, to.height) };
}

/** inset 在固定参考位图坐标内表达；随等比 transform 一同插值，首尾均保持原有裁切。 */
export function bitmapClip(viewport: CoverBox, bitmap: CoverBox, target: CoverBox, radius: string): string {
  const sx = target.width / bitmap.width, sy = target.height / bitmap.height;
  const top = Math.max(0, viewport.y - bitmap.y) * sy;
  const left = Math.max(0, viewport.x - bitmap.x) * sx;
  const right = Math.max(0, bitmap.x + bitmap.width - viewport.x - viewport.width) * sx;
  const bottom = Math.max(0, bitmap.y + bitmap.height - viewport.y - viewport.height) * sy;
  const rounded = Math.max(0, Number.parseFloat(radius) || 0);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${rounded * sx}px / ${rounded * sy}px)`;
}

export function frameRadius(radius: string, from: CoverBox, to: CoverBox): string {
  const value = Number.parseFloat(radius) || 0;
  return `${value * to.width / from.width}px / ${value * to.height / from.height}px`;
}
