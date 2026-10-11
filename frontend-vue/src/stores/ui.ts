import { defineStore } from 'pinia';
import {
  initializeTheme,
  persistTheme,
  themeTransitionAnimation,
  transitionTheme,
  type ColorTheme,
} from '../features/theme';

export type { ColorTheme, ThemeTransitionAnimation } from '../features/theme';
export { themeTransitionAnimation };

export const useUiStore = defineStore('ui', {
  state: () => ({ theme: 'light' as ColorTheme }),
  actions: {
    initialize(): void {
      this.theme = initializeTheme();
    },
    toggleTheme(origin?: { x: number; y: number }): void {
      const nextTheme: ColorTheme = this.theme === 'light' ? 'dark' : 'light';
      transitionTheme(nextTheme, origin, () => {
        this.theme = nextTheme;
        persistTheme(nextTheme);
      });
    },
  },
});
