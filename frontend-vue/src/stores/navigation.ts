import { defineStore } from 'pinia';

export type PageId = 'page-home' | 'page-eh-library' | 'page-eh-reader' | 'page-detail' | 'page-player' | 'page-settings' | 'page-eh-download' | 'page-unarchived' | 'page-archive';
export type ContextMenuMode = 'home' | 'work' | 'eh-home' | 'eh-work' | 'eh-history';

interface ConfirmationState {
  visible: boolean;
  title: string;
  body: string;
  actionText: string;
  destructive: boolean;
}

interface ContextMenuState {
  visible: boolean;
  mode: ContextMenuMode;
  workId: number | null;
  x: number;
  y: number;
}

export const useNavigationStore = defineStore('navigation', {
  state: () => ({
    activePage: 'page-home' as PageId,
    detailSource: 'media' as 'media' | 'eh',
    confirmation: {
      visible: false,
      title: '',
      body: '',
      actionText: '确认',
      destructive: false,
    } as ConfirmationState,
    contextMenu: {
      visible: false,
      mode: 'home',
      workId: null,
      x: 0,
      y: 0,
    } as ContextMenuState,
    confirmationResolver: null as ((confirmed: boolean) => void) | null,
  }),
  actions: {
    showPage(page: PageId): void {
      this.activePage = page;
    },
    askConfirm(title: string, body: string, actionText = '确认', destructive = false): Promise<boolean> {
      this.resolveConfirm(false);
      this.confirmation = { visible: true, title, body, actionText, destructive };
      return new Promise((resolve) => { this.confirmationResolver = resolve; });
    },
    resolveConfirm(confirmed: boolean): void {
      const resolver = this.confirmationResolver;
      this.confirmation.visible = false;
      this.confirmationResolver = null;
      resolver?.(confirmed);
    },
    showContextMenu(event: MouseEvent, mode: ContextMenuMode, workId: number | null = null): void {
      event.preventDefault();
      event.stopPropagation();
      this.contextMenu = {
        visible: true,
        mode,
        workId,
        x: event.clientX,
        y: event.clientY,
      };
    },
    placeContextMenu(x: number, y: number): void {
      this.contextMenu.x = x;
      this.contextMenu.y = y;
    },
    closeContextMenu(): void {
      this.contextMenu.visible = false;
    },
    closeTransientUi(): void {
      this.closeContextMenu();
      if (this.confirmation.visible) this.resolveConfirm(false);
    },
  },
});
