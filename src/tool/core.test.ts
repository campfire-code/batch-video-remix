import { describe, expect, it } from 'vitest';
import {
  assignSubtitles, buildArgs, groupOf, layoutSubtitle, makeRng, midCount, outputName, parseLines, parseSeed, permutations, planBatch, shuffle,
  sizeFor, splitDuration, totalOf, wrapText, type Clip, type Job,
} from './core';

const clip = (path: string, duration = 8, hasAudio = true): Clip => ({ path, duration, hasAudio, group: groupOf(path) });
const lib = (h: number, m: number, t: number) => [
  ...Array.from({ length: h }, (_, i) => clip(`/素材/开头/h${i}.mp4`)),
  ...Array.from({ length: m }, (_, i) => clip(`/素材/中段/m${i}.mp4`)),
  ...Array.from({ length: t }, (_, i) => clip(`/素材/结尾/t${i}.mp4`)),
];
const opt = { count: 5, total: 15, segMin: 2, segMax: 4, seed: 7 };

describe('分组与尺寸', () => {
  it('按所在文件夹名分组，Windows 路径也行', () => {
    expect(groupOf('/a/开头/x.mp4')).toBe('head');
    expect(groupOf('C:\\素材\\片尾\\x.mp4')).toBe('tail');
    expect(groupOf('/a/Intro/x.mp4')).toBe('head');
    expect(groupOf('/a/outro/x.mp4')).toBe('tail');
    expect(groupOf('/a/中段/x.mp4')).toBe('mid');
    expect(groupOf('/a/其他/x.mp4')).toBe('mid');
    expect(groupOf('开头.mp4')).toBe('mid'); // 文件名不算，只看文件夹
  });
  it('画幅与清晰度', () => {
    expect(sizeFor('9:16', '1080')).toEqual({ w: 1080, h: 1920 });
    expect(sizeFor('9:16', '720')).toEqual({ w: 720, h: 1280 });
    expect(sizeFor('1:1', '720')).toEqual({ w: 720, h: 720 });
    expect(sizeFor('16:9', '1080')).toEqual({ w: 1920, h: 1080 });
    expect(sizeFor('16:9', '720')).toEqual({ w: 1280, h: 720 });
  });
});

describe('随机数与种子', () => {
  it('同种子同序列，不同种子不同', () => {
    const a = makeRng(1), b = makeRng(1), c = makeRng(2);
    const sa = [a(), a(), a()], sb = [b(), b(), b()];
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual([c(), c(), c()]);
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true);
  });
  it('种子文本：数字原样，文字散列稳定，空为 undefined', () => {
    expect(parseSeed('42')).toBe(42);
    expect(parseSeed(' ')).toBeUndefined();
    expect(parseSeed('双十一')).toBe(parseSeed('双十一'));
    expect(parseSeed('双十一')).not.toBe(parseSeed('双十二'));
  });
  it('shuffle 不丢不重，不改原数组', () => {
    const src = [1, 2, 3, 4, 5, 6];
    const r = shuffle(src, makeRng(3));
    expect([...r].sort()).toEqual(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('时长分配', () => {
  it('总和等于目标，每段在范围内，保留一位小数', () => {
    for (let seed = 1; seed < 40; seed++) {
      const d = splitDuration(15, 5, 2, 4, makeRng(seed));
      expect(d).toHaveLength(5);
      expect(Math.round(d.reduce((a, b) => a + b, 0) * 10) / 10).toBe(15);
      for (const v of d) { expect(v).toBeGreaterThanOrEqual(2); expect(v).toBeLessThanOrEqual(4); expect(Math.round(v * 10) / 10).toBe(v); }
    }
  });
  it('目标超出可行范围时取最近的可行值', () => {
    expect(splitDuration(100, 3, 2, 4, makeRng(1))).toEqual([4, 4, 4]);
    expect(splitDuration(1, 3, 2, 4, makeRng(1))).toEqual([2, 2, 2]);
    expect(splitDuration(5, 0, 2, 4, makeRng(1))).toEqual([]);
  });
  it('min 大于 max 时互换', () => {
    const d = splitDuration(9, 3, 4, 2, makeRng(1));
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(9, 5);
  });
  it('中段片段数', () => {
    expect(midCount(15, 6, 2, 4, 10)).toBe(3);
    expect(midCount(15, 6, 2, 4, 2)).toBe(2); // 素材不够
    expect(midCount(3, 6, 2, 4, 10)).toBe(1); // 至少 1 个
  });
  it('排列数', () => {
    expect(permutations(5, 3)).toBe(60);
    expect(permutations(2, 3)).toBe(0);
    expect(permutations(4, 0)).toBe(1);
  });
});

describe('随机组合规划', () => {
  it('带种子可复现，换种子结果不同', () => {
    const c = lib(3, 6, 3);
    const a = planBatch(c, opt), b = planBatch(c, opt), d = planBatch(c, { ...opt, seed: 8 });
    expect(a).toEqual(b);
    expect(a.videos.map((v) => v.signature)).not.toEqual(d.videos.map((v) => v.signature));
  });
  it('每条 = 开头 + 中段若干 + 结尾，按组抽取', () => {
    const r = planBatch(lib(3, 6, 3), opt);
    expect(r.videos).toHaveLength(5);
    for (const v of r.videos) {
      const g = v.segments.map((s) => groupOf(s.path));
      expect(g[0]).toBe('head');
      expect(g[g.length - 1]).toBe('tail');
      expect(g.slice(1, -1).every((x) => x === 'mid')).toBe(true);
      expect(g.length - 2).toBe(r.midPer);
      expect(v.total).toBeCloseTo(15, 1);
      expect(totalOf(v.segments)).toBeCloseTo(v.total, 1);
    }
  });
  it('同一条里中段素材不重复；起点加时长不超出素材', () => {
    const c = lib(2, 5, 2);
    const byPath = new Map(c.map((x) => [x.path, x]));
    for (const v of planBatch(c, { ...opt, seed: 11 }).videos) {
      const mids = v.segments.filter((s) => groupOf(s.path) === 'mid').map((s) => s.path);
      expect(new Set(mids).size).toBe(mids.length);
      for (const s of v.segments) {
        expect(s.start).toBeGreaterThanOrEqual(0);
        expect(s.start + s.dur).toBeLessThanOrEqual(byPath.get(s.path)!.duration + 1e-6);
      }
    }
  });
  it('素材比片段短就整段用', () => {
    const r = planBatch([clip('/a/中段/s.mp4', 1.5), clip('/a/中段/t.mp4', 1.5)], { ...opt, count: 1, total: 3 });
    for (const s of r.videos[0].segments) { expect(s.start).toBe(0); expect(s.dur).toBe(1.5); }
  });
  it('去重：同一批组合不重复（组合少时全部取到）', () => {
    const c = lib(2, 4, 2); // 容量 2*2*P(4,3)=96
    const r = planBatch(c, { ...opt, count: 96, seed: 5 });
    expect(r.capacity).toBe(96);
    expect(r.videos).toHaveLength(96);
    expect(new Set(r.videos.map((v) => v.signature)).size).toBe(96);
    expect(r.warning).toBeUndefined();
  });
  it('去重：组合数很大时随机抽取也不重复', () => {
    const r = planBatch(lib(5, 12, 5), { ...opt, count: 80, seed: 9 });
    expect(r.capacity).toBeGreaterThan(5000);
    expect(r.videos).toHaveLength(80);
    expect(new Set(r.videos.map((v) => v.signature)).size).toBe(80);
  });
  it('组合数不足时只生成能生成的条数并提示', () => {
    const r = planBatch(lib(1, 3, 1), { ...opt, count: 20 }); // 3 个中段取 3 个：6 种
    expect(r.capacity).toBe(6);
    expect(r.videos).toHaveLength(6);
    expect(r.warning).toContain('只有 6 种');
    expect(r.warning).toContain('20 条');
  });
  it('只有中段素材（没有开头结尾文件夹）也能出片', () => {
    const r = planBatch(Array.from({ length: 4 }, (_, i) => clip(`/素材/m${i}.mp4`)), { ...opt, count: 3 });
    expect(r.videos).toHaveLength(3);
    expect(r.videos[0].segments.length).toBe(r.midPer);
  });
  it('没有中段素材时报错', () => {
    expect(() => planBatch(lib(2, 0, 2), opt)).toThrow('没有「中段」素材');
  });
});

describe('字幕文案', () => {
  it('解析：去空行去首尾空白', () => {
    expect(parseLines(' 甲 \r\n\n乙\n  \n')).toEqual(['甲', '乙']);
  });
  it('按顺序循环', () => {
    expect(assignSubtitles(['a', 'b', 'c'], 5, 'seq', makeRng(1))).toEqual(['a', 'b', 'c', 'a', 'b']);
  });
  it('随机：每轮用遍所有文案，轮间不连续重复，带种子可复现', () => {
    const r = assignSubtitles(['a', 'b', 'c'], 9, 'random', makeRng(4));
    for (let k = 0; k < 9; k += 3) expect([...r.slice(k, k + 3)].sort()).toEqual(['a', 'b', 'c']);
    for (let i = 1; i < r.length; i++) expect(r[i]).not.toBe(r[i - 1]);
    expect(assignSubtitles(['a', 'b', 'c'], 9, 'random', makeRng(4))).toEqual(r);
  });
  it('没有文案返回空串', () => {
    expect(assignSubtitles([], 2, 'seq', makeRng(1))).toEqual(['', '']);
  });
  it('折行与截断', () => {
    const m = (s: string) => s.length * 10;
    expect(wrapText('一二三四五六', 30, m)).toEqual(['一二三', '四五六']);
    expect(wrapText('一二三四五六七八九', 30, m)).toEqual(['一二三', '四五…']);
    const l = layoutSubtitle('示例文案', 720, 1280, 'bottom', () => m);
    expect(l.lines).toEqual(['示例文案']);
    expect(l.centerY).toBeGreaterThan(640);
    expect(layoutSubtitle('示例文案', 720, 1280, 'top', () => m).centerY).toBeLessThan(640);
  });
});

describe('ffmpeg 参数', () => {
  const segs = [
    { path: '/a/开头/h.mp4', start: 1.5, dur: 2, hasAudio: true },
    { path: '/a/中段/m.mp4', start: 0, dur: 3.5, hasAudio: false },
    { path: '/a/结尾/t.mp4', start: 2, dur: 2, hasAudio: true },
  ];
  const job = (o: Partial<Job> = {}): Job => ({ segments: segs, w: 1080, h: 1920, keepAudio: false, volume: 70, out: '/o/x.mp4', ...o });

  it('每个片段在输入端截取，统一缩放裁切，concat 拼接，无音频', () => {
    const { args, total } = buildArgs(job());
    expect(total).toBe(7.5);
    expect(args.slice(0, 12)).toEqual(['-ss', '1.5', '-t', '2', '-i', '/a/开头/h.mp4', '-ss', '0', '-t', '3.5', '-i', '/a/中段/m.mp4']);
    const g = args[args.indexOf('-filter_complex') + 1];
    expect(g).toContain('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920');
    expect(g).toContain('concat=n=3:v=1:a=0[vc]');
    expect(g).not.toContain('[a0]');
    expect(args).not.toContain('-c:a');
    expect(args[args.indexOf('-map') + 1]).toBe('[vc]');
    expect(args[args.length - 1]).toBe('/o/x.mp4');
    expect(args[args.lastIndexOf('-t') + 1]).toBe('7.5');
  });
  it('保留原声：没有音轨的素材补静音，concat 带音频', () => {
    const g = (a: string[]) => a[a.indexOf('-filter_complex') + 1];
    const { args } = buildArgs(job({ keepAudio: true }));
    expect(g(args)).toContain('[0:a:0]');
    expect(g(args)).toContain('anullsrc=r=44100:cl=stereo,atrim=0:3.5');
    expect(g(args)).not.toContain('[1:a:0]');
    expect(g(args)).toContain('concat=n=3:v=1:a=1[vc][ac]');
    expect(args).toContain('[ac]');
    expect(args).toContain('aac');
  });
  it('背景音乐：循环输入、截取、淡出、音量；与原声 amix', () => {
    const only = buildArgs(job({ music: '/m/b.mp3', volume: 50 }));
    expect(only.args.join(' ')).toContain('-stream_loop -1 -i /m/b.mp3');
    const g = only.args[only.args.indexOf('-filter_complex') + 1];
    expect(g).toContain('[3:a]atrim=0:7.5');
    expect(g).toContain('afade=t=out:st=5.5:d=2');
    expect(g).toContain('volume=0.5[am]');
    expect(only.args).toContain('[am]');
    const mixed = buildArgs(job({ music: '/m/b.mp3', keepAudio: true }));
    expect(mixed.args[mixed.args.indexOf('-filter_complex') + 1]).toContain('[ac][am]amix=inputs=2:duration=first:normalize=0[aout]');
    expect(mixed.args).toContain('[aout]');
  });
  it('字幕层作为额外输入叠加，输入序号在音乐之前', () => {
    const { args } = buildArgs(job({ subtitlePng: '/o/s.png', music: '/m/b.mp3' }));
    const g = args[args.indexOf('-filter_complex') + 1];
    expect(g).toContain('[vc][3:v]overlay=0:0');
    expect(g).toContain('[4:a]');
    expect(args).toContain('[vs]');
  });
  it('没有片段报错；输出文件名带序号', () => {
    expect(() => buildArgs(job({ segments: [] }))).toThrow('至少需要');
    expect(outputName(new Date(2026, 9, 23, 8, 5, 9), 0)).toBe('混剪-20261023-080509-001.mp4');
    expect(outputName(new Date(2026, 9, 23, 8, 5, 9), 11)).toContain('-012.mp4');
  });
});
