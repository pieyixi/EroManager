import { reactive } from 'vue';
import { systemApi } from '../../api/commands/system';
import { flushWorkRecords } from '../../api/commands/preferences';
import { usePreferencesStore } from '../../stores/preferences';
import { usePlayerStore } from '../../stores/player';
import { useEhReaderStore } from '../../stores/ehReader';
import { playerCommands } from '../player/commands';
import { useAccountsStore } from '../../stores/accounts';
import { lockAccount } from '../accounts/controller';
import { accountScope, flushAccountWrites } from '../../api/accountContext';

export const closeState = reactive({ visible: false, selected: 'tray' as 'tray' | 'exit', noAsk: false, busy: false, error: '' });
export function cancelClose(): void { if (!closeState.busy) { closeState.visible = false; closeState.error = ''; } }
async function execute(action: 'tray' | 'exit'): Promise<void> {
  const preferences = usePreferencesStore(), player = usePlayerStore();
  closeState.busy = true; closeState.error = '';
  try {
    // 托盘保留当前路由、阅读页和下载队列；仅暂停播放并落盘记录。
    if (accountScope() && player.libmpvReady) {
      playerCommands.saveProgress();
      if (!player.paused) await playerCommands.togglePlay();
    }
    if (accountScope()) useEhReaderStore().saveWorkRecord();
    await preferences.flush();
    await flushWorkRecords();
    await flushAccountWrites();
    if (action === 'tray' && useAccountsStore().privacy.minimize) await lockAccount();
    await systemApi.closeApplication(action);
    closeState.visible = false;
  } catch (error) { closeState.visible = true; closeState.error = `未能关闭：${String(error)}`; }
  finally { closeState.busy = false; }
}
export async function requestClose(): Promise<void> {
  if (closeState.busy || closeState.visible) return;
  closeState.busy = true;
  const preferences = usePreferencesStore();
  try {
    await preferences.load();
    closeState.selected = preferences.values.close_action;
    closeState.noAsk = !preferences.values.close_prompt;
    closeState.error = preferences.loaded ? '' : '偏好尚未读取，请稍后重试';
    if (!preferences.loaded || preferences.values.close_prompt) closeState.visible = true;
    else await execute(preferences.values.close_action);
  } finally { closeState.busy = false; }
}
export async function confirmClose(): Promise<void> {
  if (closeState.busy) return;
  closeState.busy = true;
  const preferences = usePreferencesStore();
  try {
    await preferences.load();
    if (!preferences.loaded) { closeState.error = '偏好读取失败，请重试'; return; }
    preferences.update({ close_action: closeState.selected, close_prompt: !closeState.noAsk });
    await execute(closeState.selected);
  } finally { closeState.busy = false; }
}
export async function requestExit(): Promise<void> { if (!closeState.busy) await execute('exit'); }
