// 截图与预览用的示例数据（不会进入正式运行）。缩略图是画布画的色块，名称都带「示例」。
import type { Row } from '../kit/runner';

function thumb(hue: number, kind: number): string {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 160, 160);
  bg.addColorStop(0, `hsl(${hue} 70% 60%)`);
  bg.addColorStop(1, `hsl(${(hue + 50) % 360} 70% 42%)`);
  g.fillStyle = bg;
  g.fillRect(0, 0, 160, 160);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  if (kind % 2) g.fillRect(52, 52, 56, 56);
  else g.fillRect(24, 66, 112, 28);
  return c.toDataURL('image/png');
}

const files: [string, number, string, number][] = [
  ['开头/示例-开头1.mp4', 4, '开头', 38],
  ['开头/示例-开头2.mp4', 4, '开头', 160],
  ['中段/示例-中段1.mp4', 6, '中段', 220],
  ['中段/示例-中段2.mp4', 6, '中段', 330],
  ['中段/示例-中段3.mp4', 6, '中段', 165],
  ['中段/示例-中段4.mp4', 6, '中段', 260],
  ['中段/示例-中段5-无音轨.mp4', 6, '中段', 85],
  ['结尾/示例-结尾1.mp4', 4, '结尾', 190],
  ['结尾/示例-结尾2.mp4', 4, '结尾', 300],
];

export const rows = (state: string): Row[] =>
  state === 'empty' ? [] : files.map(([name, secs, group, hue], i) => {
    const status: Row['status'] = state === 'done' ? 'ok' : i < 6 ? 'ok' : i === 6 ? 'run' : 'wait';
    return {
      item: { id: `v${i}`, name, path: thumb(hue, i), size: 600_000 + i * 90_000 },
      status,
      progress: status === 'run' ? 0.5 : status === 'ok' ? 1 : 0,
      result: status === 'ok' ? { data: { path: `/示例/${name}`, duration: secs, hasAudio: !name.includes('无音轨') }, summary: `${group} · ${secs.toFixed(1)} 秒${name.includes('无音轨') ? ' · 无音轨' : ''}` } : undefined,
    };
  });

export const params = { count: 5, total: 15, segMin: 2, segMax: 4, ratio: '9:16', res: '1080', keepAudio: false, music: '/示例/示例-背景音乐.wav', volume: 60, subtitles: '示例：今天下单立减 10 元\n示例：库存有限，先到先得', subOrder: 'seq', subPos: 'bottom', seed: '123' };
export const notice = { kind: 'ok' as const, text: '已生成 5 条混剪（1080×1920，每条约 15 秒，3 个中段片段）→ 下载/批量混剪工厂，随机种子 123' };
