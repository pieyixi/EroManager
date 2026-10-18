import { watch } from 'vue';
import { useAccountsStore } from '../../stores/accounts';
import { usePlayerStore } from '../../stores/player';
import { useHomeStore } from '../../stores/home';
import { currentTauriWindow, listenTauri } from '../../api/tauri';
import { lockAccount } from './controller';

export function installAccountPrivacy(): () => void {
  const accounts = useAccountsStore(), player = usePlayerStore();
  useHomeStore().enabled = false;
  let lastActivity = Date.now(), lastTick = Date.now(), background: ReturnType<typeof setTimeout> | undefined;
  let stopSystem: (() => void) | undefined, stopMinimize: (() => void) | undefined, disposed = false;
  const available = () => accounts.initialized && !accounts.locked && !accounts.selecting && !accounts.busy;
  const lock = () => { if (available()) void lockAccount(); };
  const active = () => { lastActivity = Date.now(); };
  function keyboard(event: KeyboardEvent): void {
    active();
    if (event.ctrlKey && event.shiftKey && event.code === 'KeyL') {
      event.preventDefault(); event.stopImmediatePropagation(); lock();
    }
  }
  async function checkMinimized(): Promise<void> {
    if (!accounts.privacy.minimize) return;
    const handle = currentTauriWindow();
    if (handle?.isMinimized ? await handle.isMinimized() : document.hidden) lock();
  }
  function blur(): void {
    clearTimeout(background); void checkMinimized();
    if (accounts.privacy.background_seconds === 1) lock();
    else if (accounts.privacy.background_seconds > 1) background = setTimeout(lock, accounts.privacy.background_seconds * 1000);
  }
  function focus(): void { active(); clearTimeout(background); }
  const events = [['pointerdown', active], ['pointermove', active], ['wheel', active], ['keydown', keyboard]] as const;
  for (const [event, handler] of events) document.addEventListener(event, handler as EventListener, { capture: true, passive: event !== 'keydown' });
  window.addEventListener('blur', blur); window.addEventListener('focus', focus);
  window.addEventListener('resize', checkMinimized); document.addEventListener('visibilitychange', checkMinimized);
  const stopWatch = watch(() => [accounts.locked, accounts.privacy], active, { deep: true });
  const timer = setInterval(() => {
    const now = Date.now();
    if (accounts.privacy.system && now - lastTick > 10_000) lock();
    lastTick = now;
    const playing = player.nativeVisible && !player.paused;
    if (available() && accounts.privacy.idle_seconds > 0 && now - lastActivity >= accounts.privacy.idle_seconds * 1000 && (!playing || accounts.privacy.while_playing)) lock();
  }, 1000);
  void listenTauri('privacy-system-boundary', () => { if (accounts.privacy.system) lock(); })
    .then(stop => { if (disposed) stop(); else stopSystem = stop; }).catch(() => undefined);
  void listenTauri('privacy-minimized', () => { if (accounts.privacy.minimize) lock(); })
    .then(stop => { if (disposed) stop(); else stopMinimize = stop; }).catch(() => undefined);
  return () => {
    disposed = true; clearTimeout(background); clearInterval(timer); stopSystem?.(); stopMinimize?.(); stopWatch();
    for (const [event, handler] of events) document.removeEventListener(event, handler as EventListener, true);
    window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); window.removeEventListener('resize', checkMinimized); document.removeEventListener('visibilitychange', checkMinimized);
  };
}
