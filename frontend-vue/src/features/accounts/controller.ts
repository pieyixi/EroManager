import { nextTick, watch } from 'vue';
import { accountApi } from '../../api/commands/accounts';
import { accountScope, flushAccountWrites, rememberAccountPin, setAccountScope } from '../../api/accountContext';
import { flushWorkRecords } from '../../api/commands/preferences';
import { libraryApi } from '../../api/commands/library';
import { ehApi } from '../../api/commands/eh';
import { useAccountsStore } from '../../stores/accounts';
import { useProfileStore } from '../../stores/profile';
import { usePreferencesStore } from '../../stores/preferences';
import { useLibraryStore } from '../../stores/library';
import { useEhLibraryStore } from '../../stores/ehLibrary';
import { useEhReaderStore } from '../../stores/ehReader';
import { usePlayerStore } from '../../stores/player';
import { useHomeStore } from '../../stores/home';
import { useHomeHandStore } from '../../stores/homeHand';
import { useNavigationStore } from '../../stores/navigation';
import { playerCommands } from '../player/commands';
import { cancelDetailTransition } from '../shell/detailTransition';
import { exitReaderForPrivacy } from './nativePrivacy';
import { prepareDrawImages } from '../home/images';

export async function savePersonalState(): Promise<void> {
  if (!accountScope()) return;
  const player = usePlayerStore();
  if (player.libmpvReady) { playerCommands.saveProgress(); if (!player.paused) await playerCommands.togglePlay(); }
  useEhReaderStore().saveWorkRecord();
  if (usePreferencesStore().loaded) await usePreferencesStore().flush();
  if (useHomeStore().enabled) await useHomeStore().flushPools();
  await flushWorkRecords(); await flushAccountWrites();
}
export async function obscureNativePlayer(): Promise<void> {
  const player = usePlayerStore();
  if (player.fullscreen) await playerCommands.setFullscreen(false);
  if (useNavigationStore().activePage === 'page-player') await playerCommands.returnFromPlayer();
  // 原生子窗口不能被 DOM 遮罩盖住；退出播放器布局后才展示锁屏。
  await exitReaderForPrivacy();
}
export async function hydrateAccount(): Promise<void> {
  const preferences = usePreferencesStore(), home = useHomeStore(), media = useLibraryStore(), books = useEhLibraryStore();
  home.cancelDraws(); home.$reset(); home.enabled = false; useHomeHandStore().$reset();
  preferences.$reset(); media.favoriteCharacters = []; media.favoriteCharacterMode = false;
  books.favoriteGids = []; books.favoriteMode = false;
  media.resetHomeFilters(); books.clearSearchAndFilters();
  media.currentDetail = null; media.currentDetailWorkId = null; books.currentGallery = null;
  const reader = useEhReaderStore(), generation = reader.loadGeneration;
  reader.$reset(); reader.loadGeneration = generation + 1;
  useNavigationStore().closeTransientUi(); cancelDetailTransition();
  await nextTick();
  await preferences.load(); if (!preferences.loaded) throw Error(preferences.error);
  const [favorites, favoriteGids] = await Promise.all([libraryApi.listFavoriteCharacters(), ehApi.getFavorites(), useAccountsStore().loadPrivacy(), home.restorePools()]);
  media.favoriteCharacters = favorites; books.favoriteGids = favoriteGids;
  useAccountsStore().personalKey = useAccountsStore().current?.key || 0;
  useNavigationStore().showPage(`page-${preferences.values.startup_page}`);
  home.ensureSelections(prepareDrawImages);
  if (useNavigationStore().activePage === 'page-home' && (home.media.loading || home.book.loading)) {
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(deadline); stop(); resolve(); };
      const stop = watch(() => home.media.loading || home.book.loading, loading => { if (!loading) done(); });
      const deadline = setTimeout(done, 10000);
    });
    await nextTick();
  }
}
export async function beginAccountSwitch(): Promise<void> {
  const accounts = useAccountsStore(); if (accounts.busy) return;
  accounts.busy = true; accounts.error = '';
  try { await savePersonalState(); await obscureNativePlayer(); const snapshot = await accountApi.state(); accounts.accounts = snapshot.accounts; accounts.selecting = true; }
  catch (error) { accounts.error = String(error); }
  finally { accounts.busy = false; }
}
export async function enterAccount(id: string, pin: string, beforeReveal?: () => Promise<void>): Promise<void> {
  const accounts = useAccountsStore(); if (accounts.busy) return;
  accounts.busy = true; accounts.switching = true; accounts.error = '';
  try {
    await savePersonalState(); await obscureNativePlayer();
    const previousKey = accounts.current?.key;
    const snapshot = await accountApi.auth(id, pin);
    // 门帘在全部个人数据载入前保持可见，旧内容不可交互。
    accounts.apply(snapshot); rememberAccountPin(pin); accounts.locked = true;
    if (previousKey === snapshot.current?.key && accounts.personalKey === previousKey && usePreferencesStore().loaded) {
      const [names, gids] = await Promise.all([libraryApi.listFavoriteCharacters(), ehApi.getFavorites()]);
      useLibraryStore().favoriteCharacters = names; useEhLibraryStore().favoriteGids = gids;
      useHomeStore().enabled = true;
    } else await hydrateAccount();
    await beforeReveal?.();
    accounts.locked = false; accounts.selecting = false;
  } catch (error) { accounts.error = String(error); }
  finally { accounts.busy = false; accounts.switching = false; }
}
export async function lockAccount(logout = false): Promise<void> {
  const accounts = useAccountsStore(); if (accounts.locked || accounts.busy) return;
  accounts.busy = true; accounts.error = '';
  if (accounts.current) {
    const profile = useProfileStore();
    accounts.current = { ...accounts.current, nickname: profile.nickname, avatar: profile.avatar, has_pin: profile.hasPin };
  }
  // 先遮挡并禁止输入，再刷新个人记录和隐藏原生画面。
  accounts.locked = true; accounts.selecting = logout;
  useHomeStore().enabled = false; useHomeStore().cancelDraws();
  try {
    await obscureNativePlayer(); await savePersonalState();
    if (logout) { await accountApi.logout(); accounts.current = null; useProfileStore().apply(null); }
    else await accountApi.lock();
    setAccountScope(''); useHomeStore().enabled = false; useHomeStore().cancelDraws();
  } catch (error) {
    accounts.error = `锁定时保存失败：${String(error)}`;
    await accountApi.lock().catch(() => undefined); setAccountScope('');
  }
  finally { accounts.busy = false; }
}
export const logoutAccount = () => lockAccount(true);
