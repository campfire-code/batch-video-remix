// 真机验证：默认跳过。C05_REAL=1 pnpm exec vitest run src/tool/real.test.ts
// 用 samples/ 里的示例素材和本机 ffmpeg 真的混剪几条，读回时长、分辨率、音轨，并完整解码一遍确认可播放。
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildArgs, groupOf, planBatch, sizeFor, type Clip } from './core';

const bin = (() => {
  const dir = 'src-tauri/binaries';
  const f = existsSync(dir) ? readdirSync(dir).find((n) => n.startsWith('ffmpeg-') && !n.endsWith('.txt')) : undefined;
  return f ? join(dir, f) : 'ffmpeg';
})();
const ff = (args: string[]) => execFileSync(bin, ['-hide_banner', '-nostdin', '-y', ...args], { stdio: 'pipe' });
const info = (path: string) => {
  const err = spawnSync(bin, ['-hide_banner', '-i', path], { encoding: 'utf8' }).stderr;
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err)!;
  const v = /Video: h264.*?, (\d+)x(\d+)/.exec(err);
  return { duration: +d[1] * 3600 + +d[2] * 60 + +d[3], width: v ? +v[1] : 0, height: v ? +v[2] : 0, aac: /Audio: aac/.test(err) };
};
/** 完整解码到空设备，有任何解码错误都会让 ffmpeg 返回非 0 或在 stderr 里报错 */
const decodes = (path: string) => {
  const r = spawnSync(bin, ['-hide_banner', '-nostdin', '-v', 'error', '-i', path, '-f', 'null', '-'], { encoding: 'utf8' });
  return r.status === 0 && r.stderr.trim() === '';
};
const durationOf = (p: string) => info(p).duration;
const hasAudio = (p: string) => spawnSync(bin, ['-hide_banner', '-nostdin', '-i', p, '-map', '0:a:0', '-t', '0.05', '-f', 'null', '-'], { encoding: 'utf8' }).status === 0;

const root = 'samples';
const clips: Clip[] = ['开头', '中段', '结尾'].flatMap((g) =>
  readdirSync(join(root, g)).filter((n) => n.endsWith('.mp4')).map((n) => {
    const path = join(root, g, n);
    return { path, duration: durationOf(path), hasAudio: hasAudio(path), group: groupOf(path) };
  }));

describe.runIf(process.env.C05_REAL === '1')('真机混剪', () => {
  const dir = process.env.C05_KEEP ?? mkdtempSync(join(tmpdir(), 'c05-'));
  const sub = join(dir, 'sub.png');
  const music = join(root, '示例-背景音乐.wav');

  const make = (opts: { ratio: '9:16' | '1:1' | '16:9'; keepAudio: boolean; music?: boolean; subtitle?: boolean; count?: number }) => {
    const { w, h } = sizeFor(opts.ratio, '720');
    const plan = planBatch(clips, { count: opts.count ?? 3, total: 12, segMin: 2, segMax: 4, seed: 42 });
    return plan.videos.map((v, i) => {
      const out = join(dir, `out-${opts.ratio.replace(':', 'x')}-${opts.keepAudio ? 'a' : 'n'}${opts.music ? 'm' : ''}${opts.subtitle ? 's' : ''}-${i}.mp4`);
      const { args, total } = buildArgs({ segments: v.segments, w, h, keepAudio: opts.keepAudio, music: opts.music ? music : undefined, volume: 60, subtitlePng: opts.subtitle ? sub : undefined, out });
      ff(args);
      return { out, total, w, h, v };
    });
  };
  ff(['-f', 'lavfi', '-i', 'color=c=white@0.5:s=720x1280,format=rgba', '-frames:v', '1', sub]);
  ff(['-f', 'lavfi', '-i', 'color=c=white@0.5:s=1280x720,format=rgba', '-frames:v', '1', join(dir, 'sub-wide.png')]);

  it('示例素材共 9 段，其中 1 段无音轨', () => {
    expect(clips).toHaveLength(9);
    expect(clips.filter((c) => !c.hasAudio)).toHaveLength(1);
  });

  it('9:16 保留原声（含无音轨素材补静音）：720x1280、有 AAC、时长对、能完整解码', () => {
    for (const r of make({ ratio: '9:16', keepAudio: true, count: 6 })) {
      const i = info(r.out);
      expect([i.width, i.height]).toEqual([720, 1280]);
      expect(i.aac).toBe(true);
      expect(Math.abs(i.duration - r.total)).toBeLessThan(0.2);
      expect(decodes(r.out)).toBe(true);
      expect(statSync(r.out).size).toBeGreaterThan(10_000);
    }
  }, 240_000);

  it('1:1 去原声：720x720、无音轨', () => {
    for (const r of make({ ratio: '1:1', keepAudio: false, count: 2 })) {
      const i = info(r.out);
      expect([i.width, i.height]).toEqual([720, 720]);
      expect(i.aac).toBe(false);
      expect(decodes(r.out)).toBe(true);
    }
  }, 240_000);

  it('9:16 去原声 + 背景音乐 + 字幕层', () => {
    for (const r of make({ ratio: '9:16', keepAudio: false, music: true, subtitle: true, count: 2 })) {
      const i = info(r.out);
      expect(i.aac).toBe(true);
      expect(Math.abs(i.duration - r.total)).toBeLessThan(0.2);
      expect(decodes(r.out)).toBe(true);
    }
  }, 240_000);

  it('保留原声 + 背景音乐 amix', () => {
    for (const r of make({ ratio: '9:16', keepAudio: true, music: true, count: 2 })) {
      expect(info(r.out).aac).toBe(true);
      expect(decodes(r.out)).toBe(true);
    }
  }, 240_000);

  it('16:9：1280x720', () => {
    const { w, h } = sizeFor('16:9', '720');
    const r = make({ ratio: '16:9', keepAudio: true, count: 1 })[0];
    expect([r.w, r.h]).toEqual([w, h]);
    const i = info(r.out);
    expect([i.width, i.height]).toEqual([1280, 720]);
    expect(decodes(r.out)).toBe(true);
  }, 240_000);
});
