import { defineStore } from 'pinia';
import {
  initializeTheme,
  persistTheme,
  themeTransitionAnimation,
  transitionTheme,
  transitionThemeSoft,
  type ColorTheme,
} from '../features/theme';

export type { ColorTheme, ThemeTransitionAnimation } from '../features/theme';
export { themeTransitionAnimation };

export const useUiStore = defineStore('ui', {
  state: () => ({ theme: 'light' as ColorTheme, manualThemeChoice: null as ColorTheme | null, manualThemeRevision: 0 }),
  actions: {
    initialize(): void {
      this.theme = initializeTheme();
    },
    toggleTheme(origin?: { x: number; y: number }): void {
      const nextTheme: ColorTheme = this.theme === 'light' ? 'dark' : 'light';
      this.setTheme(nextTheme, origin);
    },
    setTheme(nextTheme: ColorTheme, origin?: { x: number; y: number }, mode: 'reveal' | 'soft' = 'reveal'): void {
      if (nextTheme === this.theme) return;
      const commit = () => {
        this.theme = nextTheme;
        persistTheme(nextTheme);
        // 圆形过渡提交新主题后再同步偏好；提前通知会让偏好监听抢先执行soft换色，污染旧画面。
        if (mode === 'reveal') {
          this.manualThemeChoice = nextTheme;
          this.manualThemeRevision++;
        }
      };
      if (mode === 'soft') transitionThemeSoft(commit);
      else transitionTheme(nextTheme, origin, commit);
    },
  },
});
