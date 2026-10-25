import { defineStore } from 'pinia';

export type PageId = 'page-home' | 'page-media-library' | 'page-eh-library' | 'page-av-library' | 'page-eh-reader' | 'page-detail' | 'page-player' | 'page-settings' | 'page-eh-download' | 'page-unarchived' | 'page-archive';
export type ContextMenuMode = 'home' | 'work' | 'eh-home' | 'eh-work' | 'eh-history';
export type DetailReturnPage = 'page-home' | 'page-media-library' | 'page-eh-library' | 'page-eh-download' | 'page-av-library';

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
    pageRevision: 0,
    detailSource: 'media' as 'media' | 'eh' | 'av',
    detailReturnPage: null as DetailReturnPage | null,
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
  getters: {
    // 默认返回所属作品库；首页抽卡可显式指定首页，并贯穿播放/阅读往返。
    backPage(state): PageId {
      if (state.activePage === 'page-detail') return state.detailReturnPage || (state.detailSource === 'av' ? 'page-av-library' : state.detailSource === 'eh' ? 'page-eh-library' : 'page-media-library');
      if (state.activePage === 'page-archive') return 'page-unarchived';
      return 'page-home';
    },
  },
  actions: {
    showPage(page: PageId, detailReturnPage?: DetailReturnPage): void {
      if (page !== this.activePage) this.pageRevision += 1;
      if (page === 'page-detail') {
        // 播放/阅读回到详情时保留原入口；新的详情入口必须清除上一条返回链。
        if (detailReturnPage) this.detailReturnPage = detailReturnPage;
        else if (this.activePage !== 'page-player' && this.activePage !== 'page-eh-reader') this.detailReturnPage = null;
      }
      this.activePage = page;
    },
    goBack(): void {
      this.showPage(this.backPage);
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
