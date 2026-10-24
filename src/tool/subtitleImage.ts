// 用画布把字幕渲染成与视频同尺寸的透明 PNG（用系统自带的中文字体，不打包字体文件，因此没有字体授权问题）。
import { layoutSubtitle, type SubPos } from './core';

const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Hiragino Sans GB",sans-serif';

export async function renderSubtitlePng(text: string, w: number, h: number, pos: SubPos): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const layout = layoutSubtitle(text, w, h, pos, (size) => {
    g.font = `700 ${size}px ${FONT}`;
    return (s) => g.measureText(s).width;
  });
  g.clearRect(0, 0, w, h);
  g.font = `700 ${layout.fontSize}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const padX = layout.fontSize * 0.6;
  const padY = layout.fontSize * 0.35;
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.roundRect(w / 2 - layout.blockW / 2 - padX, layout.centerY - layout.blockH / 2 - padY, layout.blockW + padX * 2, layout.blockH + padY * 2, layout.fontSize * 0.35);
  g.fill();
  g.fillStyle = '#ffffff';
  const top = layout.centerY - layout.blockH / 2;
  layout.lines.forEach((line, i) => g.fillText(line, w / 2, top + layout.lineHeight * (i + 0.5)));
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
  if (!blob) throw new Error('字幕图片生成失败');
  return new Uint8Array(await blob.arrayBuffer());
}
