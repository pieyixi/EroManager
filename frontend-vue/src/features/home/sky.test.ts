import { describe, expect, it } from 'vitest';
import { skyForHour } from './sky';

describe('home sky icon time slots', () => {
  it('follows all eight original time ranges, including midnight', () => {
    const expected = ['late', 'late', 'pre', 'pre', 'pre', 'dawn', 'dawn', 'dawn', 'dawn',
      'morning', 'morning', 'morning', 'noon', 'noon', 'afternoon', 'afternoon', 'afternoon',
      'dusk', 'dusk', 'night', 'night', 'night', 'night', 'late'];
    expect(Array.from({ length: 24 }, (_, hour) => skyForHour(hour))).toEqual(expected);
  });
});
