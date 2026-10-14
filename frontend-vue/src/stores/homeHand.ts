import { defineStore } from 'pinia';
import type { DrawSelection, DrawSource } from './home';

export interface HandCard {
  key: string;
  source: DrawSource;
  id: number;
  title: string;
  cover: string;
}

// 暂存手牌只属于本次运行，不写 localStorage、数据库或收藏状态。
export const useHomeHandStore = defineStore('homeHand', {
  state: () => ({ cards: [] as HandCard[], activeIndex: 0 }),
  getters: {
    current: (state): HandCard | null => state.cards[state.activeIndex] || null,
  },
  actions: {
    add(source: DrawSource, selection: DrawSelection): void {
      const key = `${source}:${selection.id}`;
      const index = this.cards.findIndex((card) => card.key === key);
      // 只收封面，不把三张内页/集数截图留进手牌缓存。
      const card = { key, source, id: selection.id, title: selection.title, cover: selection.cover };
      if (index >= 0) {
        this.cards[index] = card;
        this.activeIndex = index;
      } else {
        this.cards.push(card);
        this.activeIndex = this.cards.length - 1;
      }
    },
    select(index: number): void {
      const count = this.cards.length;
      this.activeIndex = count ? ((index % count) + count) % count : 0;
    },
    step(direction: number): void { this.select(this.activeIndex + direction); },
    remove(key: string): void {
      const activeKey = this.current?.key;
      this.cards = this.cards.filter(card => card.key !== key);
      const retained = this.cards.findIndex(card => card.key === activeKey);
      this.activeIndex = retained >= 0 ? retained : Math.max(0, Math.min(this.activeIndex, this.cards.length - 1));
    },
    reconcile(mediaIds: number[], bookIds: number[]): void {
      const activeKey = this.current?.key;
      const media = new Set(mediaIds);
      const books = new Set(bookIds);
      this.cards = this.cards.filter((card) => (card.source === 'media' ? media : books).has(card.id));
      const retained = this.cards.findIndex((card) => card.key === activeKey);
      this.activeIndex = retained >= 0 ? retained : Math.max(0, Math.min(this.activeIndex, this.cards.length - 1));
    },
  },
});
