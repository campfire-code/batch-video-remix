import { describe, expect, it } from 'vitest';
import tool, { deps } from './index';
import type { BatchTool, InputItem, Params, RunContext } from '../kit/types';

const defaults = (over: Params): Params => ({ ...Object.fromEntries(tool.params.map((f) => [f.key, f.default])), ...over });
const item = (path: string): InputItem => ({ id: path, name: path.split('/').pop()!, path });

function fakeCtx(params: Params, opts: { audio?: (p: string) => boolean } = {}) {
  const calls: { ffmpeg: string[][]; probes: string[][]; written: string[]; progress: number[] } = { ffmpeg: [], probes: [], written: [], progress: [] };
  const ctx = {
    params, outputDir: '/out', signal: new AbortController().signal, progress: (v: number) => void calls.progress.push(v),
    readFile: async () => new Uint8Array(), readText: async () => '',
    writeFile: async (p: string) => void calls.written.push(p),
    writeText: async () => {}, mkdir: async () => {},
    join: async (...parts: string[]) => parts.join('/'),
    llm: async () => { throw new Error('混剪不应调用大模型'); }, sidecar: async () => '',
    ffmpeg: async (args: string[], onTime?: (s: number) => void) => {
      if (!args.includes('-filter_complex')) {
        calls.probes.push(args);
        if (opts.audio && !opts.audio(args[1])) throw new Error('Stream map matches no streams');
        return;
      }
      calls.ffmpeg.push(args);
      onTime?.(1000);
    },
    duration: async (p: string) => (p.includes('bad') ? 0 : 8),
  } as RunContext;
  return { ctx, calls };
}

const paths = ['/s/开头/h1.mp4', '/s/开头/h2.mp4', '/s/中段/m1.mp4', '/s/中段/m2.mp4', '/s/中段/m3.mp4', '/s/结尾/t1.mp4'];
async function register(ctx: RunContext, ps = paths) {
  const results = [];
  for (const p of ps) results.push({ item: item(p), result: await (tool as BatchTool).run(item(p), ctx) });
  return results;
}
const withDeps = async (fn: () => Promise<void>) => {
  const orig = { ...deps };
  deps.renderSubtitle = async () => new Uint8Array([1]);
  deps.remove = async (p) => void removed.push(p);
  deps.now = () => new Date(2026, 9, 23, 10, 0, 0);
  removed.length = 0;
  try { await fn(); } finally { Object.assign(deps, orig); }
};
const removed: string[] = [];

describe('流程', () => {
  it('不声明大模型（界面不出现大模型相关项）', () => {
    expect(tool.needsLLM).toBeFalsy();
  });
  it('check 只放行视频格式', () => {
    const check = (tool as { check: (i: InputItem) => string | null }).check;
    expect(check(item('/a/x.MP4'))).toBeNull();
    expect(check(item('/a/x.png'))).toContain('不是支持的视频格式');
  });
  it('登记：读时长、探测音轨，说明里显示分组', async () => {
    const { ctx } = fakeCtx(defaults({}), { audio: (p) => !p.includes('m2') });
    const r = await register(ctx);
    expect(r[0].result.summary).toBe('开头 · 8.0 秒');
    expect(r[3].result.summary).toBe('中段 · 8.0 秒 · 无音轨');
    expect((r[3].result.data as { hasAudio: boolean }).hasAudio).toBe(false);
  });
  it('登记：读不出时长的文件报错', async () => {
    const { ctx } = fakeCtx(defaults({}));
    await expect((tool as BatchTool).run(item('/s/中段/bad.mp4'), ctx)).rejects.toThrow('读不出视频时长');
  });
  it('整批生成指定条数，每条一次 ffmpeg，文件名带序号，同种子可复现', async () => {
    await withDeps(async () => {
      const run = async () => {
        const { ctx, calls } = fakeCtx(defaults({ count: 3, seed: '123' }));
        const msg = await tool.afterAll!(await register(ctx), ctx);
        return { calls, msg };
      };
      const a = await run(), b = await run();
      expect(a.calls.ffmpeg).toHaveLength(3);
      expect(a.calls.ffmpeg.map((x) => x[x.length - 1])).toEqual(['/out/混剪-20261023-100000-001.mp4', '/out/混剪-20261023-100000-002.mp4', '/out/混剪-20261023-100000-003.mp4']);
      expect(a.calls.ffmpeg).toEqual(b.calls.ffmpeg);
      expect(a.msg).toContain('已生成 3 条');
      expect(a.msg).toContain('1080×1920');
      expect(a.msg).toContain('随机种子 123');
      expect(a.calls.progress.at(-1)).toBeGreaterThan(0.9);
    });
  });
  it('组合数不足时提示', async () => {
    await withDeps(async () => {
      const { ctx, calls } = fakeCtx(defaults({ count: 50, total: 9, seed: '1' }));
      const msg = (await tool.afterAll!(await register(ctx), ctx)) as string;
      expect(msg).toContain('不足 50 条');
      expect(calls.ffmpeg.length).toBeLessThan(50);
    });
  });
  it('字幕：每条写一个字幕层并在合成后删除；随机/顺序；未填字幕不渲染', async () => {
    await withDeps(async () => {
      const { ctx, calls } = fakeCtx(defaults({ count: 2, subtitles: '示例一\n示例二', seed: '2' }));
      await tool.afterAll!(await register(ctx), ctx);
      expect(calls.written).toHaveLength(2);
      expect(calls.written[0]).toMatch(/-字幕层\.png$/);
      expect(removed).toEqual(calls.written);
      expect(calls.ffmpeg[0].join(' ')).toContain('-i /out/混剪-20261023-100000-001-字幕层.png');
    });
    await withDeps(async () => {
      const { ctx, calls } = fakeCtx(defaults({ count: 2, seed: '2' }));
      await tool.afterAll!(await register(ctx), ctx);
      expect(calls.written).toHaveLength(0);
    });
  });
  it('保留原声 + 背景音乐 + 横版 720p', async () => {
    await withDeps(async () => {
      const { ctx, calls } = fakeCtx(defaults({ count: 1, keepAudio: true, music: '/m/bgm.mp3', ratio: '16:9', res: '720', seed: '1' }));
      const msg = (await tool.afterAll!(await register(ctx), ctx)) as string;
      const j = calls.ffmpeg[0].join(' ');
      expect(j).toContain('-stream_loop -1 -i /m/bgm.mp3');
      expect(j).toContain('amix');
      expect(j).toContain('scale=1280:720');
      expect(msg).toContain('1280×720');
    });
  });
  it('某一条 ffmpeg 失败：其余继续，字幕层仍删除，最后报错并带成功条数', async () => {
    await withDeps(async () => {
      const { ctx, calls } = fakeCtx(defaults({ count: 3, subtitles: '示例', seed: '3' }));
      let n = 0;
      const orig = ctx.ffmpeg;
      ctx.ffmpeg = async (a, t) => { if (++n === 2) throw new Error('ffmpeg 处理失败'); return orig(a, t); };
      const reg = await register(ctx);
      n = 0;
      await expect(tool.afterAll!(reg, ctx)).rejects.toThrow(/已生成 2 条.*第 2 条：ffmpeg 处理失败/);
      expect(removed).toHaveLength(3);
      expect(calls.ffmpeg).toHaveLength(2);
    });
  });
  it('没有中段素材时报错', async () => {
    const { ctx } = fakeCtx(defaults({}));
    await expect(tool.afterAll!(await register(ctx, ['/s/开头/h1.mp4', '/s/结尾/t1.mp4']), ctx)).rejects.toThrow('没有「中段」素材');
  });
});
