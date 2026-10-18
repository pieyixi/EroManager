type InvokeArgs = Record<string, unknown>;

interface TauriCore {
  invoke<T>(command: string, args?: InvokeArgs): Promise<T>;
  convertFileSrc?(path: string): string;
}

export interface TauriWindowHandle {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  maximize(): Promise<void>;
  unmaximize(): Promise<void>;
  close(): Promise<void>;
  startDragging(): Promise<void>;
  isMaximized(): Promise<boolean>;
  isMinimized?(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  onResized(handler: () => void): Promise<() => void>;
}

interface TauriGlobal {
  core?: TauriCore;
  event?: {
    listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
  };
  window?: {
    getCurrentWindow?(): TauriWindowHandle;
  };
  invoke?: TauriCore['invoke'];
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
  }
}

function core(): TauriCore | undefined {
  if (window.__TAURI__?.core) return window.__TAURI__.core;
  if (window.__TAURI__?.invoke) return { invoke: window.__TAURI__.invoke };
  return undefined;
}

function browserMockEnabled(): boolean {
  return import.meta.env.DEV && !core();
}
export { browserMockEnabled as isBrowserMockRuntime };

export function isTauriConnected(): boolean {
  return Boolean(core()) || browserMockEnabled();
}

export async function invokeTauri<T>(command: string, args?: InvokeArgs): Promise<T> {
  const tauri = core();
  if (tauri) return tauri.invoke<T>(command, args);
  if (browserMockEnabled()) {
    const { invokeBrowserMock } = await import('./webMock');
    return invokeBrowserMock<T>(command, args);
  }
  throw new Error('Tauri runtime is not connected');
}

export async function listenTauri<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  const listen = window.__TAURI__?.event?.listen;
  if (listen) return listen<T>(event, ({ payload }) => handler(payload));
  if (browserMockEnabled()) {
    const { listenBrowserMock } = await import('./webMock');
    return listenBrowserMock(event, handler);
  }
  throw new Error('Tauri event runtime is not connected');
}

export function convertFilePath(path: string): string {
  const convertFileSrc = window.__TAURI__?.core?.convertFileSrc;
  if (convertFileSrc) return convertFileSrc(path);
  return `file:///${path.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:')}`;
}

export function currentTauriWindow(): TauriWindowHandle | null {
  return window.__TAURI__?.window?.getCurrentWindow?.() || null;
}

export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  if (browserMockEnabled()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
    defaultPath: defaultPath || undefined,
  });
  return typeof selected === 'string' ? selected : null;
}
