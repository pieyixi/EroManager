// 回归比较可见裁切窗口，而非可能伸出窗口的完整等比位图。
async function visibleFlightImage(page) {
  return page.locator('.home-detail-flight-image').evaluate(element => {
    const rect = element.getBoundingClientRect(), css = getComputedStyle(element), matrix = new DOMMatrixReadOnly(css.transform);
    const match = css.clipPath.match(/^inset\((.*?)(?:\s+round|\))/);
    if (!match) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    const values = match[1].trim().split(/\s+/).map(Number.parseFloat);
    const [top, right = top, bottom = top, left = right] = values;
    return { x: rect.x + left * matrix.a, y: rect.y + top * matrix.d,
      width: rect.width - (left + right) * matrix.a, height: rect.height - (top + bottom) * matrix.d };
  });
}
async function flightViewport(page) {
  return page.locator('.home-detail-flight').evaluate(element => {
    const clip = getComputedStyle(element).clipPath;
    if (!clip.startsWith('polygon(')) return null;
    const values = [...clip.matchAll(/(-?[\d.]+)px/g)].map(value => Number(value[1]));
    return { x: values[0], y: values[1], width: values[2] - values[0], height: values[5] - values[1] };
  });
}
function intersectBoxes(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}
module.exports = { visibleFlightImage, flightViewport, intersectBoxes };
