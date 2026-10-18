import { nextTick, shallowRef } from 'vue';
import type { DrawSource } from '../../stores/home';

export type DetailCoverOrigin = DrawSource | 'hand' | `media-grid:${number}` | `book-grid:${number}` | `download:${number}`;
export const coverOrigin = (area: 'media-grid' | 'book-grid' | 'download', id: number): DetailCoverOrigin => `${area}:${id}`;
export function detailOriginPage(origin: DetailCoverOrigin): 'page-home' | 'page-media-library' | 'page-eh-library' | 'page-eh-download' {
  if (origin.startsWith('media-grid:')) return 'page-media-library';
  if (origin.startsWith('book-grid:')) return 'page-eh-library';
  if (origin.startsWith('download:')) return 'page-eh-download';
  return 'page-home';
}
interface Box { x: number; y: number; width: number; height: number }
interface CoverPose { box: Box; image: Box; radius: string; imageRadius: string; background: string; border: string }
export interface CoverFlight { src: string; from: CoverPose; to: CoverPose }
export const detailTransitionSource = shallowRef<DetailCoverOrigin | null>(null);
export const detailTransitionDirection = shallowRef<'enter' | 'return' | null>(null);
export const stableDetailPages = shallowRef(false);
export const coverFlight = shallowRef<CoverFlight | null>(null);
export const coverFlightVisible = shallowRef(false);
export const detailReturnOrigin = shallowRef<{ origin: DetailCoverOrigin; source: DrawSource; id: number } | null>(null);
interface CoverElements { element: HTMLElement; image: HTMLImageElement | null }
const covers = new Map<DetailCoverOrigin | 'detail', CoverElements>();
let flightFrame: HTMLElement | null = null;
let flightImage: HTMLImageElement | null = null;
let motions: Animation[] = [];
let revision = 0;
let running: Promise<void> | undefined;
let returnQueued = false;

export function registerDetailCover(key: DetailCoverOrigin | 'detail', element: HTMLElement | null, image: HTMLImageElement | null = null): void {
  if (element) covers.set(key, { element, image }); else covers.delete(key);
}
export function registerCoverFlight(frame: HTMLElement | null, image: HTMLImageElement | null): void {
  flightFrame = frame; flightImage = image;
}
const box = (rect: DOMRect): Box => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
function capture(elements: CoverElements | undefined): { src: string; pose: CoverPose } | null {
  if (!elements) return null;
  const { element, image } = elements;
  const bounds = element.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  // 封面与图片均由局部 Vue ref 登记，不查询 DOM，也不复制整页快照。
  const css = getComputedStyle(element);
  return { src: image?.currentSrc || image?.src || '', pose: {
    box: box(bounds), image: box(image?.getBoundingClientRect() || bounds),
    radius: css.borderRadius, imageRadius: image ? getComputedStyle(image).borderRadius : css.borderRadius,
    background: css.backgroundColor, border: css.borderColor,
  } };
}
export function flightTransform(from: Box, to: Box): string {
  return `translate3d(${from.x}px, ${from.y}px, 0) scale(${from.width / to.width}, ${from.height / to.height})`;
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
export async function openCoverDetail(origin: DetailCoverOrigin, open: () => Promise<void>, identity?: { source: DrawSource; id: number }): Promise<void> {
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
  detailTransitionSource.value = origin;
  coverFlight.value = { src: from.src, from: from.pose, to: from.pose };
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
    const to = capture(covers.get(direction === 'enter' ? 'detail' : origin));
    if (!to || !flightFrame || !flightImage) return;
    coverFlight.value = { src: from.src, from: from.pose, to: to.pose };
    detailTransitionDirection.value = direction;
    await nextTick();
    if (request !== revision) return;
    const animate = (element: HTMLElement, start: Box, end: Box) => element.animate([
      { transform: flightTransform(start, end) }, { transform: flightTransform(end, end) },
    ], { duration: 600, easing: 'cubic-bezier(.32, 0, .2, 1)', fill: 'both' });
    // 两个小图层：卡框和已解码图片；尺寸只设置一次，动画仅交给合成器插值 transform。
    motions = [animate(flightFrame, from.pose.box, to.pose.box), animate(flightImage, from.pose.image, to.pose.image)];
    await Promise.all(motions.map(motion => motion.finished));
  } catch { /* 离页/窗口尺寸变化取消动画时直接交还真实封面。 */ }
  finally { if (request === revision) cleanFlight(); }
}
