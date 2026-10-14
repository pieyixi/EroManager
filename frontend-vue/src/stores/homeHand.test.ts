import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useHomeHandStore } from './homeHand';

const selection = (id: number) => ({ id, title: `Work ${id}`, cover: `cover-${id}`, previews: [{ key: '1', label: 'page', image: 'large-page' }] });
beforeEach(() => { setActivePinia(createPinia()); });

describe('process-local home hand', () => {
  it('keeps source collisions and signed Hitomi IDs distinct, deduplicates a repeated drop, and excludes previews', () => {
    const hand = useHomeHandStore();
    hand.add('media', selection(7));
    hand.add('book', selection(7));
    hand.add('book', selection(-7));
    hand.add('media', { ...selection(7), title: 'Updated' });
    expect(hand.cards.map((card) => card.key)).toEqual(['media:7', 'book:7', 'book:-7']);
    expect(hand.current?.title).toBe('Updated');
    expect(hand.cards[0]).not.toHaveProperty('previews');
  });
  it('cycles in both directions and safely handles empty and one-card hands', () => {
    const hand = useHomeHandStore();
    hand.step(-1);
    expect(hand.current).toBeNull();
    hand.add('media', selection(1));
    hand.step(1);
    expect(hand.current?.id).toBe(1);
    hand.add('media', selection(2));
    hand.add('book', selection(3));
    hand.step(1);
    expect(hand.current?.id).toBe(1);
    hand.step(-1);
    expect(hand.current?.id).toBe(3);
  });
  it('reconciles deleted library works without losing the retained current card', () => {
    const hand = useHomeHandStore();
    hand.add('media', selection(1));
    hand.add('book', selection(1));
    hand.add('book', selection(-1));
    hand.reconcile([], [1, -1]);
    expect(hand.current?.key).toBe('book:-1');
    hand.reconcile([], [1]);
    expect(hand.current?.key).toBe('book:1');
    hand.reconcile([], []);
    expect(hand.current).toBeNull();
    expect(hand.activeIndex).toBe(0);
  });
  it('starts empty with each new application session', () => {
    useHomeHandStore().add('media', selection(1));
    setActivePinia(createPinia());
    expect(useHomeHandStore().cards).toEqual([]);
  });
  it('removes only the requested temporary card and retains a neighboring selection safely', () => {
    const hand = useHomeHandStore();
    hand.add('media', selection(7));
    hand.add('book', selection(7));
    hand.add('book', selection(-7));
    hand.remove('media:7');
    expect(hand.cards.map(card => card.key)).toEqual(['book:7', 'book:-7']);
    expect(hand.current?.key).toBe('book:-7');
    hand.remove('book:-7');
    expect(hand.current?.key).toBe('book:7');
    hand.remove('not-present');
    expect(hand.cards).toHaveLength(1);
    hand.remove('book:7');
    expect(hand.cards).toEqual([]);
    expect(hand.activeIndex).toBe(0);
  });
});
