import { onBeforeUnmount, onMounted, ref } from 'vue';
import { currentTauriWindow, type TauriWindowHandle } from '../../api/tauri';
import { requestClose } from './closeController';
import { useAccountsStore } from '../../stores/accounts';
import { lockAccount } from '../accounts/controller';

/** 普通壳层和播放器标题栏共用窗口操作；阅读器原生全屏仍由阅读器独立管理。 */
export function useShellWindowControls() {
  const maximized = ref(false);
  let appWindow: TauriWindowHandle | null = null;
  let stopResize: (() => void) | null = null;

  async function syncMaximized(): Promise<void> {
    if (appWindow)
      maximized.value = await appWindow.isMaximized().catch(() => false);
  }

  async function minimizeWindow(): Promise<void> {
    if (useAccountsStore().privacy.minimize) await lockAccount();
    await appWindow?.minimize();
  }

  async function toggleMaximize(): Promise<void> {
    await appWindow?.toggleMaximize();
    await syncMaximized();
  }

  async function closeWindow(): Promise<void> {
    await requestClose();
  }
  onMounted(async () => {
    appWindow = currentTauriWindow();
    await syncMaximized();
    if (appWindow)
      stopResize = await appWindow
        .onResized(() => {
          void syncMaximized();
        })
        .catch(() => null);
  });
  onBeforeUnmount(() => { stopResize?.(); });
  return { maximized, minimizeWindow, toggleMaximize, closeWindow };
}
