export function wrapHandIndex(index: number, count: number): number {
  return count ? ((index % count) + count) % count : 0;
}

/** 只在整数步的主牌正后方回收节点；半步时背牌仍会从前牌之间露出，不能在那里换牌。 */
export function handSlots(count: number, position: number) {
  if (!count) return [];
  if (count === 1) return [{ virtual: 0, index: 0, distance: 0 }];
  if (count === 2) return [0, 1].map(index => ({ virtual: index, index, distance: index - position }));
  const first = Math.ceil(position - 3);
  const slots = Array.from({ length: 7 }, (_, offset) => {
    const virtual = first + offset;
    return { virtual, index: wrapHandIndex(virtual, count), distance: virtual - position };
  }).filter(item => Math.abs(item.distance) <= 3);
  return slots.filter(item => !slots.some(other => other.index === item.index &&
    (Math.abs(other.distance) < Math.abs(item.distance) ||
      (Math.abs(other.distance) === Math.abs(item.distance) && other.virtual < item.virtual))));
}

export function nextHandPosition(position: number, direction: number, count: number): number {
  const next = Math.round(position) + direction;
  return count === 2 ? wrapHandIndex(next, count) : next;
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function handPose(distance: number, count = 4) {
  const depth = Math.abs(distance);
  // 前半圈保持原来的展开幅度；副牌继续沿后半圈绕行，而非立刻缩进主牌下面。
  // 少量牌走真实闭环；大牌堆只保留近处一圈，最远端被主牌自然遮住后再回收。
  const rearProgress = count > 2 ? Math.max(0, Math.min(1, (depth - 1) / (Math.min(3, count / 2) - 1))) : 0;
  const rear = smoothstep(rearProgress);
  const x = count <= 2 ? distance * 78 : Math.sign(distance) * 78 *
    (depth <= 1 ? Math.sin(depth * Math.PI / 2) : Math.cos(rearProgress * Math.PI / 2));
  const scale = 1 - .3 * smoothstep(depth) - .22 * rear;
  return {
    x,
    y: -18 * rear,
    scale,
    opacity: 1,
    layer: Math.round(100 - 50 * (1 - scale) / .52),
  };
}

export function snapHandPosition(position: number, velocity: number): number {
  return Math.round(position + Math.max(-.35, Math.min(.35, velocity * 110)));
}
