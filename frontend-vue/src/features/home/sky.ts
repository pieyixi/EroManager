/** 使用本机时刻选择用户提供的八档天空图标；不负责生成问候文案。 */
export function skyForHour(hour: number) {
  if (hour >= 23 || hour < 2) return 'late';
  if (hour < 5) return 'pre';
  if (hour < 9) return 'dawn';
  if (hour < 12) return 'morning';
  if (hour < 14) return 'noon';
  if (hour < 17) return 'afternoon';
  if (hour < 19) return 'dusk';
  return 'night';
}
