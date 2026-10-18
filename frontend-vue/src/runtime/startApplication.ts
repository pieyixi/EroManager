import { installAccountPrivacy } from '../features/accounts/privacyRuntime';
import { installAccountAdminUpdates } from '../features/accounts/adminUpdates';
import { installPlayerController } from '../features/player/controller';
import { useLibraryStore } from '../stores/library';
import { installApplicationEvents } from './applicationEvents';
import { isBrowserMockRuntime } from '../api/tauri';
import { installPreferencesRuntime } from './preferencesRuntime';
import type { StartupScreenHooks } from '../features/shell/useStartupScreen';

export function startApplicationRuntime(startup: StartupScreenHooks): () => void {
  document.body.dataset.frontend = 'vue';
  const library = useLibraryStore();
  const stopAccounts = installAccountPrivacy();
  const stopAdminUpdates = installAccountAdminUpdates();
  const stopPreferences = installPreferencesRuntime();
  const stopPlayer = installPlayerController();
  const stopEvents = installApplicationEvents(library, startup);
  let disposed = false;
  let stopFixtures: (() => void) | undefined;
  if (import.meta.env.DEV && isBrowserMockRuntime()) {
    void import('./browserDownloadFixtures').then(({ installBrowserDownloadFixtures }) => {
      if (!disposed) stopFixtures = installBrowserDownloadFixtures();
    });
  }
  return () => {
    disposed = true;
    stopFixtures?.();
    stopEvents();
    stopPlayer();
    stopPreferences();
    stopAccounts();
    stopAdminUpdates();
  };
}
