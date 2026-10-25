import type { AvWork, AvActress } from '../contracts/av';

/** 纯浏览器夹具：不抓取站点，不使用个人照片，也不写入正式库。 */
export function createAvScene(): AvWork[] {
  const colors = ['#f5b7c7', '#b9d9f3', '#d9c5ef', '#bfe2d0', '#f0d6a8', '#c8d2ee'];
  const picture = (index: number, portrait: boolean, label: string): string => {
    const width = portrait ? 360 : 720;
    const cx = portrait ? 180 : 540;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="480" viewBox="0 0 ${width} 480"><rect width="${width}" height="480" fill="${colors[index % colors.length]}"/>${portrait
      ? '<path d="M66 480v-92c0-68 228-68 228 0v92" fill="#4b5871" opacity=".35"/><path d="M105 176c0-100 150-100 150 0v65H105Z" fill="#48516b"/><ellipse cx="180" cy="193" rx="65" ry="83" fill="#f6e3d8"/><path d="M110 172c0-100 150-100 140 7-36-2-59-25-69-46-15 27-38 39-71 39Z" fill="#48516b"/><path d="M151 204h8m42 0h8m-39 37q10 8 20 0" stroke="#8b6e71" stroke-width="5" stroke-linecap="round" fill="none"/>'
      : `<circle cx="${cx + 50}" cy="96" r="110" fill="#334155" opacity=".13"/><path d="M360 380Q530 265 720 350V480H360Z" fill="#334155" opacity=".2"/>`}
      <text x="${portrait ? 22 : 382}" y="440" font-family="sans-serif" font-size="24" fill="#334155">${label}</text><text x="22" y="465" font-family="sans-serif" font-size="12" fill="#334155" opacity=".6">WEB MOCK</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  const actresses: AvActress[] = Array.from({ length: 14 }, (_, i) => ({
    id: `actress-${i + 1}`, name: ['桜井あおい', '白石ひなた', '七瀬りん', '月島ゆい', '花宮さくら', '朝比奈みお', '水野すず', '小野なつき', '星野まい', '橘ことね', '森川あかり', '青山はる', '夏目しおり', '藤咲まどか'][i],
    aliases: [`示例女优${i + 1}`], photo: picture(i, true, `PORTRAIT ${String(i + 1).padStart(2, '0')}`),
  }));
  return Array.from({ length: 48 }, (_, i) => {
    const code = `DEMO-${String(100 + i).padStart(3, '0')}`;
    return { code, title: `${['春の日記', '夏の思い出', '秋の便り', '冬の物語'][i % 4]} ${i + 1}`,
      cover: picture(i, false, code), cover_layout: 'jacket', release_date: `${2026 - Math.floor(i / 16)}-${String(12 - i % 12).padStart(2, '0')}-15`,
      duration_minutes: 90 + i % 6 * 10, studio: ['Studio A', 'Studio B', 'Studio C'][i % 3],
      series: ['季節の日記', '街からの便り', '花の物語'][i % 3], tags: [['制服', '長髪'], ['眼鏡', '室内'], ['旅行', '短髪'], ['日常', '長髪']][i % 4],
      actresses: i % 7 === 0 ? [actresses[i % 14], actresses[(i + 1) % 14]] : [actresses[i % 14]],
      folder_path: `D:\\MockAvLibrary\\${code}`, source_url: '', queued_at: '',
      previews: Array.from({ length: 8 }, (_, n) => `mock://av-preview/${code}/${n+1}`), magnets: [],
      videos: i % 4 === 2 ? [] : [
        ...(i % 4 === 3 ? [] : [{ id: 1, kind: 'original', file_name: `${code.replace('-', ' ')}.wmv`, video_path: `mock://av-video/${code}/original` }]),
        ...(i % 4 === 1 ? [] : [{ id: 2, kind: 'cut', file_name: `${code}~cut.mp4`, video_path: `mock://av-video/${code}/cut` }]),
      ] };
  });
}
