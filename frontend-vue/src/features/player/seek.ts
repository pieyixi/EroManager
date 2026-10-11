import type { PlayerStore } from '../../stores/player';

interface SeekPreview {
  show(event: PointerEvent): number;
  hide(): void;
}

export interface PlayerSeekController {
  beginKeySeek(direction: number): void;
  stopKeySeek(): void;
  seekTo(value: number): Promise<void>;
  beginPointerSeek(event: PointerEvent): void;
  movePointerSeek(event: PointerEvent): void;
  endPointerSeek(event: PointerEvent): void;
}

interface SeekDependencies {
  player: PlayerStore;
  isPlayerActive: () => boolean;
  thumbnails: SeekPreview;
  seekRelative: (delta: number) => Promise<void>;
  setSpeed: (value: number) => Promise<void>;
  pollStatus: () => Promise<void>;
  mpvCommand: (name: string, args?: unknown[]) => Promise<unknown>;
  mpvSetProperty: (name: string, value: unknown) => Promise<unknown>;
  formatTime: (seconds: number) => string;
  message: (kind?: string, text?: string) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPlayerSeekController(deps: SeekDependencies): PlayerSeekController {
  const { player } = deps;
  let keySeekTimer: number | null = null;
  let keySeekInterval: number | null = null;
  let pointerSeekWasPaused = false;

  function stopKeySeek(): void {
    if (keySeekTimer !== null) window.clearTimeout(keySeekTimer);
    if (keySeekInterval !== null) window.clearInterval(keySeekInterval);
    keySeekTimer = null;
    keySeekInterval = null;
    if (player.keySeekDirection > 0 && player.libmpvReady) void deps.setSpeed(1);
    player.keySeekDirection = 0;
  }

  function beginKeySeek(direction: number): void {
    if (!deps.isPlayerActive() || !player.libmpvReady || player.keySeekDirection === direction) return;
    stopKeySeek();
    player.keySeekDirection = direction;
    void deps.seekRelative(direction * 3);
    keySeekTimer = window.setTimeout(() => {
      keySeekTimer = null;
      if (player.keySeekDirection !== direction) return;
      if (direction > 0) void deps.setSpeed(3);
      else keySeekInterval = window.setInterval(() => { void deps.seekRelative(-3); }, 180);
    }, 260);
  }

  function previewSeek(value: number): void {
    player.currentTime = Math.max(0, Number(value) || 0);
    if (!player.editingTime) player.timeInput = deps.formatTime(player.currentTime);
  }

  function queueAbsoluteSeek(value: number, exact: boolean): void {
    const duration = Number(player.duration) || 0;
    let target = Math.max(0, Number(value) || 0);
    if (duration > 0) target = Math.min(duration, target);
    player.pendingSeek = { value: target, exact };
    void drainSeekQueue();
  }

  async function drainSeekQueue(): Promise<void> {
    if (player.seekCommandRunning || !player.libmpvReady) return;
    player.seekCommandRunning = true;
    try {
      while (player.pendingSeek) {
        const next = player.pendingSeek;
        player.pendingSeek = null;
        await deps.mpvCommand('seek', [next.value, next.exact ? 'absolute+exact' : 'absolute+keyframes']);
      }
      if (!player.isSeeking) await deps.pollStatus();
    } catch (error) {
      deps.message('err', errorText(error));
    } finally {
      player.seekCommandRunning = false;
      if (player.pendingSeek) void drainSeekQueue();
    }
  }

  async function seekTo(value: number): Promise<void> {
    previewSeek(value);
    queueAbsoluteSeek(player.currentTime, true);
  }

  function beginPointerSeek(event: PointerEvent): void {
    if (!player.libmpvReady) return;
    event.preventDefault();
    pointerSeekWasPaused = player.paused;
    const target = deps.thumbnails.show(event);
    player.isSeeking = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    previewSeek(target);
    queueAbsoluteSeek(player.currentTime, false);
  }

  function movePointerSeek(event: PointerEvent): void {
    const target = deps.thumbnails.show(event);
    if (!player.isSeeking) return;
    event.preventDefault();
    previewSeek(target);
    queueAbsoluteSeek(player.currentTime, false);
  }

  function endPointerSeek(event: PointerEvent): void {
    if (!player.isSeeking) return;
    event.preventDefault();
    const target = deps.thumbnails.show(event);
    if (event.type !== 'pointercancel') previewSeek(target);
    player.isSeeking = false;
    const element = event.currentTarget as HTMLElement;
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
    element.blur();
    queueAbsoluteSeek(player.currentTime, true);
    void deps.mpvSetProperty('pause', pointerSeekWasPaused)
      .then(deps.pollStatus)
      .catch((error) => deps.message('err', errorText(error)));
    window.setTimeout(deps.thumbnails.hide, 450);
  }

  return { beginKeySeek, stopKeySeek, seekTo, beginPointerSeek, movePointerSeek, endPointerSeek };
}
