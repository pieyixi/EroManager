import { isTauriConnected, listenTauri } from "../api/tauri";
import { requestClose, requestExit } from '../features/shell/closeController';
import { playerCommands } from "../features/player/commands";
import type { useLibraryStore } from "../stores/library";
import { useNavigationStore } from "../stores/navigation";
import { usePlayerStore } from "../stores/player";
import { useLibraryConsoleStore } from "../stores/libraryConsole";
import { useEhLibraryStore } from "../stores/ehLibrary";
import { useEhReaderStore } from "../stores/ehReader";
import { usePreferencesStore } from "../stores/preferences";
import { useAccountsStore } from "../stores/accounts";
import { useHomeStore } from "../stores/home";
import type { StartupScreenHooks } from '../features/shell/useStartupScreen';

type LibraryStore = ReturnType<typeof useLibraryStore>;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
}

export function installApplicationEvents(library: LibraryStore, startup: StartupScreenHooks): () => void {
  const navigation = useNavigationStore();
  const player = usePlayerStore();
  const settings = useLibraryConsoleStore();
  const cleanups: Array<() => void> = [];
  let disposed = false;
  for (const [event, handler] of [['app-close-requested', requestClose], ['app-exit-requested', requestExit]] as const) {
    void listenTauri(event, () => { void handler(); }).then(stop => {
      if (disposed) stop(); else cleanups.push(stop);
    }).catch(() => undefined);
  }

  function listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    listener: (event: WindowEventMap[K]) => void,
  ): void {
    target.addEventListener(type, listener as EventListener);
    cleanups.push(() =>
      target.removeEventListener(type, listener as EventListener),
    );
  }

  function listenDocument<K extends keyof DocumentEventMap>(
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
  ): void {
    document.addEventListener(type, listener as EventListener);
    cleanups.push(() =>
      document.removeEventListener(type, listener as EventListener),
    );
  }

  function handlePlayerKeydown(event: KeyboardEvent): boolean {
    if (navigation.activePage !== "page-player") return false;
    const seekFocused =
      event.target instanceof HTMLElement && event.target.id === "playerSeek";
    if (isTypingTarget(event.target) && !seekFocused) return false;
    if (event.key === " ") {
      if (!event.repeat) void playerCommands.togglePlay();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (!event.repeat)
        playerCommands.beginKeySeek(event.key === "ArrowRight" ? 1 : -1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (!event.repeat)
        playerCommands.adjustVolume(event.key === "ArrowUp" ? 5 : -5);
    } else if (event.key === "," || event.key === ".") {
      if (!event.repeat)
        void playerCommands.stepFrame(event.key === "," ? -1 : 1);
    } else if (event.key.toLowerCase() === "m") {
      if (!event.repeat) void playerCommands.toggleMute();
    } else if (event.key.toLowerCase() === "f") {
      if (!event.repeat) void playerCommands.toggleFullscreen();
    } else if (event.key === "Enter" && player.mode === "archive") {
      if (!event.repeat) void playerCommands.captureCurrentFrame();
    } else if (event.key === "Escape") {
      if (!event.repeat) {
        if (player.fullscreen) void playerCommands.setFullscreen(false);
        else void playerCommands.returnFromPlayer();
      }
    } else return false;
    event.preventDefault();
    return true;
  }

  function handlePlayerKeyup(event: KeyboardEvent): void {
    if (navigation.activePage !== "page-player") return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      playerCommands.stopKeySeek();
      event.preventDefault();
    }
  }

  listenDocument("keydown", (event) => {
    if (!useAccountsStore().locked && !useAccountsStore().selecting) handlePlayerKeydown(event);
  });
  listenDocument("keyup", handlePlayerKeyup);
  listenDocument("contextmenu", (event) => {
    event.preventDefault();
    const insideMediaGrid =
      navigation.activePage === "page-media-library" &&
      event
        .composedPath()
        .some((node) => node instanceof HTMLElement && node.id === "coverGrid");
    if (insideMediaGrid) return;
    library.closeDropdown();
    navigation.closeContextMenu();
  });

  let resizeTimer: number | null = null;
  listen(window, "resize", () => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (navigation.activePage === "page-player")
        playerCommands.scheduleBoundsSync();
    }, 80);
  });
  listen(window, "focus", () => {
    if (navigation.activePage === "page-player")
      playerCommands.scheduleBoundsSync();
  });
  listen(window, "mouseup", () => {
    if (navigation.activePage === "page-player")
      playerCommands.scheduleBoundsSync();
  });

  if (isTauriConnected()) {
    const startupRevision = navigation.pageRevision;
    void (async () => {
      const preferences = usePreferencesStore();
      const accounts = useAccountsStore();
      await accounts.initialize();
      if (!accounts.locked) await Promise.all([accounts.loadPrivacy(), useHomeStore().restorePools()]);
      await preferences.load();
      if (!accounts.locked && preferences.loaded) accounts.personalKey = accounts.current?.key || 0;
      const status = await settings.initializeMediaLibrary();
      await Promise.all([library.initialize({ deferCoverPrefetch: true }), useEhLibraryStore().load()]);
      if (disposed) return;
      await startup.prepare();
      if (disposed) return;
      if (status.needs_binding) await settings.openSettingsPage();
      else if (navigation.pageRevision === startupRevision) {
        navigation.showPage(`page-${preferences.values.startup_page}`);
      }
      const preview = import.meta.env.DEV
        ? new URLSearchParams(window.location.search).get("preview")
        : null;
      if (preview === "settings") await settings.openSettingsPage();
      if (
        preview === "eh-reader"
      ) {
        const ehLibrary = useEhLibraryStore();
        await ehLibrary.load();
        if (ehLibrary.galleries[0]) {
          await useEhReaderStore().open(ehLibrary.galleries[0]);
          const reader = useEhReaderStore();
          reader.spreadIndex = Number(
            new URLSearchParams(window.location.search).get("spread") || 0,
          );
          reader.toolsVisible = true;
          reader.settingsVisible =
            new URLSearchParams(window.location.search).get("settings") === "1";
        }
      }
    })().catch(error => { console.error('application startup failed:', error); }).finally(startup.finish);
  } else { library.showDisconnected(); startup.finish(); }

  return () => {
    disposed = true;
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    cleanups.reverse().forEach((cleanup) => cleanup());
  };
}
