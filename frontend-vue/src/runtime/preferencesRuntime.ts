import { watch } from 'vue';
import { persistTheme } from '../features/theme';
import { usePreferencesStore } from '../stores/preferences';
import { useUiStore } from '../stores/ui';
import { useLibraryStore } from '../stores/library';
import { useEhLibraryStore } from '../stores/ehLibrary';

export function installPreferencesRuntime(): () => void {
  const preferences = usePreferencesStore();
  const ui = useUiStore();
  const media = useLibraryStore();
  const books = useEhLibraryStore();
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const resolveTheme = (theme: 'light' | 'dark' | 'system') => theme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme;
  const followSystem = () => {
    if (preferences.loaded && preferences.values.theme === 'system') ui.setTheme(resolveTheme('system'), undefined, 'soft');
  };
  systemTheme.addEventListener('change', followSystem);
  let hydrated = false;
  const stops = [
    watch(() => [preferences.loaded, preferences.values.theme] as const, ([loaded, theme]) => {
      if (!loaded) return;
      if (theme) localStorage.setItem('media-library-theme-mode', theme);
      if (!hydrated) {
        hydrated = true;
        if (theme) { ui.theme = resolveTheme(theme); persistTheme(ui.theme); }
        else preferences.update({ theme: ui.theme });
      } else if (theme && resolveTheme(theme) !== ui.theme) ui.setTheme(resolveTheme(theme), undefined, 'soft');
    }),
    watch(() => ui.manualThemeRevision, () => {
      if (preferences.loaded && ui.manualThemeChoice) preferences.update({ theme: ui.manualThemeChoice });
    }),
    watch(() => [preferences.loaded, preferences.values.media_sort, preferences.values.book_sort] as const,
      ([loaded, mediaSort, bookSort]) => {
        if (loaded) { media.currentSort = mediaSort; books.currentSort = bookSort; }
      }),
    watch(() => media.currentSort, media_sort => {
      if (preferences.loaded && media_sort !== preferences.values.media_sort) preferences.update({ media_sort });
    }),
    watch(() => books.currentSort, book_sort => {
      if (preferences.loaded && book_sort !== preferences.values.book_sort) preferences.update({ book_sort });
    }),
  ];
  return () => { stops.forEach(stop => stop()); systemTheme.removeEventListener('change', followSystem); };
}
