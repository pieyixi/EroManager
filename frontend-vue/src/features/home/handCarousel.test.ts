import { describe, expect, it } from 'vitest';
import { handPose, handSlots, nextHandPosition, snapHandPosition, wrapHandIndex } from './handCarousel';

describe('continuous hand carousel', () => {
  it('keeps empty and one-card hands stable, without cloning a second work into both side slots', () => {
    expect(handSlots(0, 10)).toEqual([]);
    expect(handSlots(1, 10)).toEqual([{ virtual: 0, index: 0, distance: 0 }]);
    const slots = handSlots(2, 0);
    expect(slots).toHaveLength(2);
    expect(slots.find(item => item.distance === -1)).toBeUndefined();
    expect(slots.find(item => item.distance === 1)?.index).toBe(1);
    expect(handSlots(2, 1).find(item => item.distance === -1)?.index).toBe(0);
    expect(nextHandPosition(1, 1, 2)).toBe(0);
    expect(nextHandPosition(0, -1, 2)).toBe(1);
    expect(nextHandPosition(4, 1, 5)).toBe(5);
    expect(wrapHandIndex(-1, 5)).toBe(4);
    expect(wrapHandIndex(11, 5)).toBe(1);
  });
  it('keeps the same physical virtual card through first/last work boundaries', () => {
    const before = handSlots(3, 2.99).find(item => item.virtual === 3)!;
    const after = handSlots(3, 3.01).find(item => item.virtual === 3)!;
    expect(before.index).toBe(0);
    expect(after.index).toBe(0);
    expect(before.distance - after.distance).toBeCloseTo(.02);
    expect(handSlots(10000, 100.4).length).toBeLessThanOrEqual(7);
  });
  it('moves and resizes each card continuously instead of translating its container', () => {
    const center = handPose(0), halfway = handPose(.5), side = handPose(1), hidden = handPose(2);
    expect(center.scale).toBe(1);
    expect(halfway.scale).toBeCloseTo(.85);
    expect(side.scale).toBe(.7);
    expect(center.x).toBe(0);
    expect(halfway.x).toBeCloseTo(78 * Math.SQRT1_2);
    expect(side.x).toBe(78);
    expect(hidden.opacity).toBe(1);
    expect(hidden.x).toBeCloseTo(0);
    expect(hidden.scale).toBeCloseTo(.48);
    expect(hidden.layer).toBeLessThan(side.layer);
    expect(handPose(1.3).x).toBeLessThan(side.x);
    expect(handPose(1.3).opacity).toBe(1);
    expect(handPose(-.5).scale).toBe(halfway.scale);
    expect(handPose(-.5).x).toBe(-halfway.x);
  });
  it('keeps three- and four-card rings unique and joins their back seams continuously', () => {
    for (const count of [3, 4]) {
      for (const position of [0, .49, .51, 1, 3.99, 4.01]) {
        const slots = handSlots(count, position);
        expect(new Set(slots.map(slot => slot.index)).size).toBe(slots.length);
        expect(slots).toHaveLength(count);
      }
      const left = handPose(-count / 2 + .001, count);
      const right = handPose(count / 2 - .001, count);
      expect(Math.abs(left.x - right.x)).toBeLessThan(.5);
      expect(handPose(-count / 2, count).x).toBeCloseTo(handPose(count / 2, count).x);
      expect(left.scale).toBeCloseTo(right.scale);
      expect(left.opacity).toBe(1);
    }
    expect(handPose(3, 10000).x).toBeCloseTo(0);
    expect(handPose(3, 10000).scale).toBeCloseTo(.48);
  });
  it('exposes the rear orbit between the moving front cards and recycles only beneath the integer-step main', () => {
    const left = handPose(-.5, 9), right = handPose(.5, 9);
    expect(left.x + left.scale * 50).toBeLessThan(right.x - right.scale * 50);
    expect(handPose(2, 9).x).toBeGreaterThan(50);
    expect(handPose(2.5, 9).x).toBeGreaterThan(25);
    // 每个回收端都在主牌矩形之内，且透明度不变；不是用遮罩或缩短后半圈藏掉动画。
    const rear = handPose(3, 9);
    expect(rear.x).toBeCloseTo(0);
    expect(-rear.y + rear.scale * 100).toBeLessThan(100);
    expect(rear.opacity).toBe(1);
    const before = handSlots(9, .999).map(slot => slot.index);
    const after = handSlots(9, 1.001).map(slot => slot.index);
    expect(before.filter(index => !after.includes(index))).toEqual([7]);
    expect(after.filter(index => !before.includes(index))).toEqual([4]);
    expect(handSlots(9, .499).map(slot => slot.index)).toEqual(handSlots(9, .501).map(slot => slot.index));
  });
  it('snaps to the nearest card, with bounded flick momentum in either direction', () => {
    expect(snapHandPosition(2.2, 0)).toBe(2);
    expect(snapHandPosition(2.7, 0)).toBe(3);
    expect(snapHandPosition(2.2, .004)).toBe(3);
    expect(snapHandPosition(2.8, -.004)).toBe(2);
    expect(snapHandPosition(2.2, 999)).toBe(3);
  });
});
