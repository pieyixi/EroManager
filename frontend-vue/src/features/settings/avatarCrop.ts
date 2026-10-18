export const CROP_STAGE = 320;
export const CROP_DIAMETER = 240;
export interface CropImage { width: number; height: number }
export interface CropPosition { zoom: number; x: number; y: number }

export function cropScale(image: CropImage, zoom: number): number {
  return CROP_DIAMETER / Math.min(image.width, image.height) * zoom;
}
export function clampCrop(image: CropImage, position: CropPosition): CropPosition {
  const zoom = Math.min(5, Math.max(1, position.zoom));
  const scale = cropScale(image, zoom);
  const limitX = Math.max(0, (image.width * scale - CROP_DIAMETER) / 2);
  const limitY = Math.max(0, (image.height * scale - CROP_DIAMETER) / 2);
  return { zoom, x: Math.min(limitX, Math.max(-limitX, position.x)), y: Math.min(limitY, Math.max(-limitY, position.y)) };
}
export function zoomCrop(image: CropImage, position: CropPosition, zoom: number, anchor = { x: 0, y: 0 }): CropPosition {
  const bounded = Math.min(5, Math.max(1, zoom)), ratio = bounded / position.zoom;
  return clampCrop(image, { zoom: bounded, x: anchor.x - (anchor.x - position.x) * ratio, y: anchor.y - (anchor.y - position.y) * ratio });
}
export function cropSource(image: CropImage, position: CropPosition) {
  const scale = cropScale(image, position.zoom), size = CROP_DIAMETER / scale;
  return { x: image.width / 2 - position.x / scale - size / 2, y: image.height / 2 - position.y / scale - size / 2, size };
}

/** 本次编辑独占图片资源；缩小预览后释放原图，不留整图缓存。 */
export async function prepareAvatar(file: File): Promise<HTMLImageElement> {
  if (!/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(file.type)) throw new Error('请选择 JPG、PNG、WebP 等图片');
  if (file.size > 20 * 1024 * 1024) throw new Error('请选择小于 20 MB 的图片');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片无法读取');
    const factor = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * factor));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
    const context = canvas.getContext('2d'); if (!context) throw new Error('图片编辑暂不可用');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const preview = new Image(); preview.src = canvas.toDataURL('image/png'); await preview.decode();
    return preview;
  } finally { URL.revokeObjectURL(url); }
}
export function renderAvatar(image: HTMLImageElement, position: CropPosition): string {
  const source = cropSource({ width: image.naturalWidth, height: image.naturalHeight }, position);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d'); if (!context) throw new Error('图片编辑暂不可用');
  context.imageSmoothingQuality = 'high';
  context.beginPath(); context.arc(256, 256, 256, 0, Math.PI * 2); context.clip();
  context.drawImage(image, source.x, source.y, source.size, source.size, 0, 0, 512, 512);
  return canvas.toDataURL('image/png');
}
