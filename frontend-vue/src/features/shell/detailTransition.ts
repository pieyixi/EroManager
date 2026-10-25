import { nextTick, shallowRef } from 'vue';
import type { DrawSource } from '../../stores/home';
import { bitmapClip, coverBitmap, coverRaster, flightTransform, frameRadius, intersectCoverBox, type CoverBox } from './coverGeometry';
export { flightTransform } from './coverGeometry';

export type DetailCoverOrigin = DrawSource | 'hand' | `media-grid:${number}` | `book-grid:${number}` | `download:${number}` | `av-grid:${string}` | `av-download:${string}`;
export const avCoverOrigin = (area: 'av-grid' | 'av-download', code: string): DetailCoverOrigin => `${area}:${code}`;
export const coverOrigin = (area: 'media-grid' | 'book-grid' | 'download', id: number): DetailCoverOrigin => `${area}:${id}`;
export function detailOriginPage(origin: DetailCoverOrigin): 'page-home' | 'page-media-library' | 'page-eh-library' | 'page-eh-download' | 'page-av-library' {
  if (origin.startsWith('av-grid:')) return 'page-av-library';
  if (origin.startsWith('av-download:')) return 'page-eh-download';
  if (origin.startsWith('media-grid:')) return 'page-media-library';
  if (origin.startsWith('book-grid:')) return 'page-eh-library';
  if (origin.startsWith('download:')) return 'page-eh-download';
  return 'page-home';
}
interface CoverPose { box: CoverBox; image: CoverBox; bitmap: CoverBox; radius: string; imageRadius: string; background: string; border: string; shadow: string; sourceClip?: CoverBox }
export interface CoverFlight { src: string; from: CoverPose; to: CoverPose; raster: CoverBox; container: HTMLElement | null; viewport: { from: CoverBox; to: CoverBox } | null }
export const detailTransitionSource = shallowRef<DetailCoverOrigin | null>(null);
export const detailTransitionDirection = shallowRef<'enter' | 'return' | null>(null);
export const stableDetailPages = shallowRef(false);
export const coverFlight = shallowRef<CoverFlight | null>(null);
export const coverFlightVisible = shallowRef(false);
export const detailReturnOrigin = shallowRef<{ origin: DetailCoverOrigin; source: DrawSource | 'av'; id: number | string } | null>(null);
interface CoverElements { element: HTMLElement; image: HTMLImageElement | null; viewport: HTMLElement | null }
const covers = new Map<DetailCoverOrigin | 'detail', CoverElements>();
let flightFrame: HTMLElement | null = null;
let flightImage: HTMLImageElement | null = null;
let flightViewport: HTMLElement | null = null;
let motions: Animation[] = [];
let revision = 0;
let running: Promise<void> | undefined;
let returnQueued = false;
let scrollAnchor: { origin: DetailCoverOrigin; offset: number; visible: number } | null = null;

export function registerDetailCover(key: DetailCoverOrigin | 'detail', element: HTMLElement | null, image: HTMLImageElement | null = null, viewport: HTMLElement | null = null): void {
  if (element) covers.set(key, { element, image, viewport }); else covers.delete(key);
}
export function registerCoverFlight(frame: HTMLElement | null, image: HTMLImageElement | null, viewport: HTMLElement | null = null): void {
  flightFrame = frame; flightImage = image; flightViewport = viewport;
}
export function coverViewportKeyframe(clip: CoverBox): { clipPath: string } {
  const right = clip.x + clip.width, bottom = clip.y + clip.height;
  return { clipPath: `polygon(${clip.x}px ${clip.y}px, ${right}px ${clip.y}px, ${right}px ${bottom}px, ${clip.x}px ${bottom}px)` };
}
const box = (rect: DOMRect): CoverBox => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
function capture(elements: CoverElements | undefined): { src: string; pose: CoverPose; viewport: HTMLElement | null; clip: CoverBox | null } | null {
  if (!elements) return null;
  const { element, image } = elements;
  const bounds = element.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  // 封面与图片均由局部 Vue ref 登记，不查询 DOM，也不复制整页快照。
  const css = getComputedStyle(element);
  const imageBox = box(image?.getBoundingClientRect() || bounds);
  const imageCss = image ? getComputedStyle(image) : null;
  const viewport = elements.viewport;
  const viewportBox = viewport?.getBoundingClientRect();
  const clip = viewport && viewportBox && viewportBox.width > 0 && viewportBox.height > 0
    ? { x: viewportBox.x + viewport.clientLeft, y: viewportBox.y + viewport.clientTop, width: viewport.clientWidth, height: viewport.clientHeight } : null;
  return { src: image?.currentSrc || image?.src || '', viewport: clip ? viewport : null, clip, pose: {
    box: box(bounds), image: intersectCoverBox(imageBox, box(bounds)),
    bitmap: coverBitmap(imageBox, image?.naturalWidth || 0, image?.naturalHeight || 0, imageCss?.objectFit, imageCss?.objectPosition),
    radius: css.borderRadius, imageRadius: imageCss?.borderRadius || css.borderRadius,
    background: css.backgroundColor, border: css.borderColor, shadow: css.boxShadow,
  } };
}

export function coverFrameKeyframe(pose: CoverPose, target: CoverPose): Keyframe {
  return { transform: flightTransform(pose.box, target.box), borderRadius: frameRadius(pose.radius, pose.box, target.box),
    backgroundColor: pose.background, borderColor: pose.border, boxShadow: pose.shadow, opacity: pose.sourceClip ? 0 : 1 };
}
export function coverFrameKeyframes(from: CoverPose, to: CoverPose): Keyframe[] {
  return [
    { ...coverFrameKeyframe(from, to), opacity: from.sourceClip ? 0 : 1, offset: 0 },
    // 底框只在端点衔接；主要移动阶段不绘制留白或外框阴影，避免透明留白仍被阴影勾成一圈。
    { backgroundColor: 'transparent', borderColor: 'transparent', boxShadow: 'none', offset: .015 },
    { backgroundColor: 'transparent', borderColor: 'transparent', boxShadow: 'none', offset: .995 },
    { ...coverFrameKeyframe(to, to), offset: 1 },
  ];
}
export function coverImageKeyframe(pose: CoverPose, raster: CoverBox): Keyframe {
  const visible = pose.sourceClip ? intersectCoverBox(pose.image, pose.sourceClip) : pose.image;
  return { transform: flightTransform(pose.bitmap, raster), clipPath: bitmapClip(visible, pose.bitmap, raster, pose.imageRadius) };
}
function cleanFlight(): void {
  coverFlightVisible.value = false;
  coverFlight.value = null;
  motions.forEach(motion => motion.cancel()); motions = [];
  detailTransitionSource.value = null;
  detailTransitionDirection.value = null;
}
export function cancelDetailTransition(): void {
  revision += 1;
  cleanFlight();
  stableDetailPages.value = false;
}
export async function openCoverDetail(origin: DetailCoverOrigin, open: () => Promise<void>, identity?: { source: DrawSource | 'av'; id: number | string }): Promise<void> {
  if (running || detailTransitionSource.value) return;
  detailReturnOrigin.value = identity ? { origin, ...identity } : null;
  running = runTransition(origin, 'enter', open);
  try { await running; }
  finally { running = undefined; }
}
export async function returnCoverDetail(origin: DetailCoverOrigin, back: () => void): Promise<void> {
  if (returnQueued) return;
  returnQueued = true;
  const request = revision;
  try {
    if (running) await running;
    if (request !== revision) return;
    running = runTransition(origin, 'return', async () => back());
    await running;
  } finally { running = undefined; returnQueued = false; }
}
async function runTransition(origin: DetailCoverOrigin, direction: 'enter' | 'return', update: () => Promise<void>): Promise<void> {
  const request = ++revision;
  stableDetailPages.value = true;
  // 先结束手牌按压/摇摆的 DOM 更新，再读稳定起点。
  await nextTick();
  if (request !== revision) return;
  const from = capture(covers.get(direction === 'enter' ? origin : 'detail'));
  if (!from) { await update(); return; }
  if (direction === 'enter') scrollAnchor = from.clip ? {
    origin, offset: from.pose.image.y - from.clip.y,
    visible: intersectCoverBox(from.pose.image, from.clip).height,
  } : null;
  // 进入时从滚动区实际可见的部分展开，不能先补出被容器遮住的半张。
  if (direction === 'enter' && from.clip) {
    const visible = intersectCoverBox(from.pose.image, from.clip);
    if (visible.width < from.pose.image.width - .1 || visible.height < from.pose.image.height - .1) from.pose.sourceClip = from.clip;
  }
  detailTransitionSource.value = origin;
  coverFlight.value = { src: from.src, from: from.pose, to: from.pose, raster: from.pose.bitmap, container: null, viewport: null };
  await nextTick();
  try {
    try { await flightImage?.decode(); } catch { /* 缺图仍可使用卡框过渡。 */ }
    if (request !== revision) return;
    coverFlightVisible.value = true;
    await nextTick();
    if (request !== revision) return;
    await update();
    await nextTick();
    if (request !== revision) return;
    let to = capture(covers.get(direction === 'enter' ? 'detail' : origin));
    if (!to || !flightFrame || !flightImage) return;
    // 队列入列/结束可能在详情期间改变卡片行位置。按点击作品恢复锚点，而非把旧 scrollTop 当作落点。
    if (direction === 'return' && to.viewport && to.clip && scrollAnchor?.origin === origin) {
      const minimumVisible = Math.min(32, scrollAnchor.visible, to.pose.image.height, to.clip.height);
      const offset = Math.min(to.clip.height - minimumVisible, Math.max(minimumVisible - to.pose.image.height, scrollAnchor.offset));
      to.viewport.scrollTop += to.pose.image.y - to.clip.y - offset;
      to = capture(covers.get(origin));
      if (!to) return;
    }
    const raster = coverRaster(from.pose.bitmap, to.pose.bitmap);
    // 裁剪窗口与封面共用进度，从详情可见区连续过渡到结果区；禁止首帧瞬间换成目标列窗口。
    const viewport = direction === 'return' && to.clip ? { from: from.pose.image, to: to.clip } : null;
    coverFlight.value = { src: from.src, from: from.pose, to: to.pose, raster,
      container: direction === 'return' ? to.viewport : null, viewport };
    detailTransitionDirection.value = direction;
    await nextTick();
    if (request !== revision) return;
    const animate = (element: HTMLElement, keyframes: Keyframe[]) => element.animate(keyframes,
      { duration: 600, easing: 'cubic-bezier(.32, 0, .2, 1)', fill: 'both' });
    // 仍只有卡框/图片两层，宽高固定、位置尺寸通过 transform；裁切与外观连续衔接，避免首帧换比例。
    motions = [animate(flightFrame, coverFrameKeyframes(from.pose, to.pose)),
      animate(flightImage, [coverImageKeyframe(from.pose, raster), coverImageKeyframe(to.pose, raster)])];
    if (viewport && flightViewport) motions.push(animate(flightViewport, [coverViewportKeyframe(viewport.from), coverViewportKeyframe(viewport.to)]));
    await Promise.all(motions.map(motion => motion.finished));
  } catch { /* 离页/窗口尺寸变化取消动画时直接交还真实封面。 */ }
  finally { if (request === revision) cleanFlight(); }
}
