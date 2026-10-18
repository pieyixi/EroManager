export type ColorTheme = 'light' | 'dark';

export interface ThemeTransitionAnimation {
  clipPath: [string, string];
  easing: string;
  pseudoElement: '::view-transition-new(root)' | '::view-transition-old(root)';
}

const themeStorageKey = 'media-library-theme';
const themeTransitionDuration = 480;
const themeTransitionEasing = 'cubic-bezier(.22,.8,.28,1)';
let themeTransitionRunning = false;
let softTimer: ReturnType<typeof setTimeout> | undefined;

export function transitionThemeSoft(commit: () => void): void {
  clearTimeout(softTimer);
  const root = document.documentElement;
  root.dataset.themeSoft = 'true';
  // 先应用过渡规则，再切换颜色；不创建整页快照或圆形遮罩。
  void root.offsetWidth;
  commit();
  softTimer = setTimeout(() => { delete root.dataset.themeSoft; }, 260);
}

function applyTheme(theme: ColorTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function storedTheme(): ColorTheme {
  if (window.localStorage.getItem('media-library-theme-mode') === 'system') {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return window.localStorage.getItem(themeStorageKey) === 'dark' ? 'dark' : 'light';
}

export function persistTheme(theme: ColorTheme): void {
  window.localStorage.setItem(themeStorageKey, theme);
  applyTheme(theme);
}

export function initializeTheme(): ColorTheme {
  const theme = storedTheme();
  applyTheme(theme);
  return theme;
}

export function themeTransitionAnimation(
  nextTheme: ColorTheme,
  origin: { x: number; y: number },
  viewport: { width: number; height: number },
): ThemeTransitionAnimation {
  const radius = Math.hypot(
    Math.max(origin.x, viewport.width - origin.x),
    Math.max(origin.y, viewport.height - origin.y),
  );
  const collapsed = `circle(0 at ${origin.x}px ${origin.y}px)`;
  const expanded = `circle(${radius}px at ${origin.x}px ${origin.y}px)`;
  return nextTheme === 'dark'
    ? { clipPath: [collapsed, expanded], easing: themeTransitionEasing, pseudoElement: '::view-transition-new(root)' }
    : { clipPath: [expanded, collapsed], easing: themeTransitionEasing, pseudoElement: '::view-transition-old(root)' };
}

function afterTwoFrames(callback: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}

export function transitionTheme(
  nextTheme: ColorTheme,
  origin: { x: number; y: number } | undefined,
  commit: () => void,
): void {
  if (themeTransitionRunning) return;
  clearTimeout(softTimer);
  delete document.documentElement.dataset.themeSoft;
  const startViewTransition = (document as unknown as {
    startViewTransition?: (callback: () => void) => { ready: Promise<void>; finished: Promise<void> };
  }).startViewTransition?.bind(document);
  // The Windows "Animate controls and elements" switch is exposed by WebView2
  // as prefers-reduced-motion. It must not silently remove Ark's explicit theme
  // reveal; only fall back when the View Transition API itself is unavailable.
  if (!startViewTransition) {
    commit();
    return;
  }
  themeTransitionRunning = true;
  document.documentElement.dataset.themeTransition = nextTheme;
  const transition = startViewTransition(commit);
  void transition.ready.then(() => {
    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const spec = themeTransitionAnimation(nextTheme, { x, y }, { width: window.innerWidth, height: window.innerHeight });
    const animation = document.documentElement.animate(
      { clipPath: spec.clipPath },
      { duration: themeTransitionDuration, easing: spec.easing, fill: 'both', pseudoElement: spec.pseudoElement },
    );
    void Promise.allSettled([animation.finished, transition.finished]).then(() => {
      afterTwoFrames(() => {
        animation.cancel();
        delete document.documentElement.dataset.themeTransition;
        themeTransitionRunning = false;
      });
    });
  }).catch(() => {
    delete document.documentElement.dataset.themeTransition;
    themeTransitionRunning = false;
  });
}
