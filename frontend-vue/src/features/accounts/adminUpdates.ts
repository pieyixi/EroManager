import { listenTauri } from '../../api/tauri';
import { accountApi } from '../../api/commands/accounts';
import { accountScope, setAccountScope } from '../../api/accountContext';
import { useAccountsStore } from '../../stores/accounts';
import { useHomeStore } from '../../stores/home';
import { obscureNativePlayer } from './controller';

/** 管理终端已在后端撤销 scope；先遮挡原生内容，再读取新的账号列表。 */
export function installAccountAdminUpdates(): () => void {
  const accounts = useAccountsStore(), home = useHomeStore();
  let disposed = false, pending = false, revoke = false, running = false, stop: (() => void) | undefined;
  let boundary = Promise.resolve();
  async function refresh(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (pending && !disposed) {
        const force = revoke; pending = false; revoke = false;
        if (force) {
          await boundary;
        }
        const scope = accountScope(), selecting = accounts.selecting;
        const snapshot = await accountApi.state();
        if (disposed) return;
        if (scope !== accountScope()) { pending = true; continue; }
        accounts.apply(snapshot);
        if (!force && !snapshot.locked) accounts.selecting = selecting;
      }
    } catch (error) { if (!disposed) accounts.error = `账号信息更新失败：${String(error)}`; }
    finally { running = false; if (pending && !disposed) void refresh(); }
  }
  void listenTauri<boolean>('accounts-admin-changed', force => {
    if (force) {
      // 前一次列表请求即使仍在等待，也先阻止旧账号交互和隐藏原生播放器。
      accounts.locked = true; home.enabled = false; home.cancelDraws(); setAccountScope('');
      boundary = obscureNativePlayer().catch(error => { accounts.error = `播放器退出失败：${String(error)}`; });
    }
    pending = true; revoke ||= force; void refresh();
  }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; }).catch(() => undefined);
  return () => { disposed = true; stop?.(); };
}
