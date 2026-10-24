// 生成示例素材：node scripts/make-samples.mjs
// 用本机 ffmpeg 合成色块/几何图形动画，分「开头 / 中段 / 结尾」三个文件夹，不含任何真实品牌、人物或他人作品。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';

const bdir = new URL('../src-tauri/binaries/', import.meta.url).pathname;
const f = existsSync(bdir) ? readdirSync(bdir).find((n) => n.startsWith('ffmpeg-') && !n.endsWith('.txt')) : undefined;
const bin = f ? bdir + f : 'ffmpeg';
const root = new URL('../samples/', import.meta.url).pathname;
const ff = (a) => execFileSync(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });

// [文件夹, 文件名, 宽, 高, 秒数, 背景色0, 背景色1, 图形色, 图形类型, 音调(0=无音轨)]
const clips = [
  ['开头', '示例-开头1.mp4', 720, 1280, 4, '0xF2B134', '0xE4572E', '0xFFFFFF', 'bar', 523],
  ['开头', '示例-开头2.mp4', 1280, 720, 4, '0x2E7D6B', '0x17BEBB', '0xFFF3B0', 'box', 587],
  ['中段', '示例-中段1.mp4', 720, 1280, 6, '0x3A86FF', '0x8338EC', '0xFFFFFF', 'box', 330],
  ['中段', '示例-中段2.mp4', 720, 1280, 6, '0xFF006E', '0xFB5607', '0xFFE066', 'bar', 349],
  ['中段', '示例-中段3.mp4', 1280, 720, 6, '0x06D6A0', '0x118AB2', '0xFFFFFF', 'box', 392],
  ['中段', '示例-中段4.mp4', 1080, 1080, 6, '0x6A4C93', '0x1982C4', '0xFFCA3A', 'bar', 440],
  ['中段', '示例-中段5-无音轨.mp4', 720, 1280, 6, '0x8AC926', '0x1B998B', '0xFFFFFF', 'box', 0],
  ['结尾', '示例-结尾1.mp4', 720, 1280, 4, '0x264653', '0x2A9D8F', '0xE9C46A', 'bar', 262],
  ['结尾', '示例-结尾2.mp4', 1080, 1080, 4, '0x540D6E', '0xEE4266', '0xFFD23F', 'box', 294],
];
for (const [dir, name, w, h, secs, c0, c1, fg, shape, tone] of clips) {
  mkdirSync(root + dir, { recursive: true });
  const s = Math.round(Math.min(w, h) * 0.28);
  const move = `x='(W-w)/2+(W-w)/3*sin(2*PI*t/${secs})':y='(H-h)/2+(H-h)/6*sin(4*PI*t/${secs})'`;
  const art = shape === 'box'
    ? `color=c=${fg}:s=${s}x${s}:r=30:d=${secs}`
    : `color=c=${fg}:s=${Math.round(w * 0.7)}x${Math.round(s * 0.35)}:r=30:d=${secs}`;
  const args = ['-f', 'lavfi', '-i', `gradients=s=${w}x${h}:d=${secs}:r=30:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${w}:y1=${h}`, '-f', 'lavfi', '-i', art];
  if (tone) args.push('-f', 'lavfi', '-i', `sine=frequency=${tone}:sample_rate=44100:duration=${secs}`);
  args.push('-filter_complex', `[0:v][1:v]overlay=${move},format=yuv420p[v]${tone ? ';[2:a]volume=0.25[a]' : ''}`, '-map', '[v]');
  if (tone) args.push('-map', '[a]', '-c:a', 'aac');
  args.push('-c:v', 'libx264', '-crf', '22', '-t', String(secs), root + dir + '/' + name);
  ff(args);
}
// 背景音乐：和弦琶音，纯合成
ff(['-f', 'lavfi', '-i', "aevalsrc='0.2*sin(2*PI*(262+if(gte(mod(t,1),0.5),66,0))*t)*exp(-2*mod(t,0.5))':s=44100:d=8", root + '示例-背景音乐.wav']);
console.log('已生成 samples/ 下的 9 段示例素材和 示例-背景音乐.wav');
