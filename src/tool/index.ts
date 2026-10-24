// 工具声明：批量混剪工厂
// 批量模式：每个素材先登记（读时长、检查有无音轨），整批登记完后由 afterAll 按组随机抽取片段，逐条合成多个 MP4。
// 不使用大模型：kit 的「设置」页由 needsLLM 静态决定是否出现，做不到「不用 AI 时界面无大模型项」，所以不做 AI 文案。
import { Shapes } from 'lucide-react';
import type { InputItem, ToolDef } from '../kit/types';
import {
  VIDEO_EXTS, AUDIO_EXTS, assignSubtitles, buildArgs, groupOf, makeRng, outputName, parseLines, parseSeed, planBatch, sizeFor,
  type Clip, type RatioKey, type ResKey, type SubPos,
} from './core';
import { renderSubtitlePng } from './subtitleImage';

async function removeQuiet(path: string) {
  try {
    const { remove } = await import('@tauri-apps/plugin-fs');
    await remove(path);
  } catch {
    // 删不掉就留着，不影响成片
  }
}

/** 可替换的外部依赖，测试里换成假的 */
export const deps = { renderSubtitle: renderSubtitlePng, remove: removeQuiet, now: () => new Date() };

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const GROUP_LABEL = { head: '开头', mid: '中段', tail: '结尾' } as const;

interface ClipData { path: string; duration: number; hasAudio: boolean }

const tool: ToolDef = {
  id: 'c05',
  name: '批量混剪工厂',
  tagline: '素材按开头、中段、结尾随机组合，一次出几十条',
  category: '内容生产',
  type: 'media',
  icon: Shapes,
  mode: 'batch',
  resultView: 'list',
  concurrency: 3,
  accept: { label: '素材视频', extensions: VIDEO_EXTS },
  check: (item) => (VIDEO_EXTS.includes(ext(item.name)) ? null : '不是支持的视频格式（支持 MP4、MOV、M4V、MKV、AVI、WEBM）'),
  params: [
    { key: 'count', label: '生成条数', type: 'number', default: 5, min: 1, max: 200, step: 1, unit: '条', help: '同一批里素材组合不重复；组合数不足时只生成能生成的条数并提示' },
    { key: 'total', label: '每条目标时长', type: 'number', default: 15, min: 3, max: 120, step: 1, unit: '秒' },
    { key: 'segMin', label: '片段最短', type: 'number', default: 2, min: 0.5, max: 30, step: 0.5, unit: '秒' },
    { key: 'segMax', label: '片段最长', type: 'number', default: 4, min: 0.5, max: 30, step: 0.5, unit: '秒', help: '每个片段在这个范围内随机取时长，起点也随机；素材比它短就整段使用' },
    { key: 'ratio', label: '画幅', type: 'segment', options: [['9:16', '竖版 9:16'], ['1:1', '方形 1:1'], ['16:9', '横版 16:9']], default: '9:16', help: '素材比例不同时铺满画面，多出的部分裁掉' },
    { key: 'res', label: '清晰度', type: 'segment', options: [['720', '720p'], ['1080', '1080p']], default: '1080' },
    { key: 'keepAudio', label: '保留素材原声', type: 'toggle', default: false, help: '关闭则成片没有原声；没有音轨的素材会自动补静音' },
    { key: 'music', label: '背景音乐（可选）', type: 'file', extensions: AUDIO_EXTS, fileLabel: '音频文件', default: '', help: '比成片长会截取并在结尾淡出，比成片短会循环。请确认你有该音乐的使用权' },
    { key: 'volume', label: '音乐音量', type: 'number', when: (p) => String(p.music ?? '') !== '', default: 70, min: 0, max: 100, step: 5, unit: '%' },
    { key: 'subtitles', label: '字幕文案（可选）', type: 'textarea', rows: 4, default: '', placeholder: '每行一条文案，例如：\n示例：今天下单立减 10 元\n示例：库存有限，先到先得', help: '每条成片取一句，整段显示；最多显示 2 行' },
    { key: 'subOrder', label: '文案取法', type: 'segment', when: (p) => String(p.subtitles ?? '').trim() !== '', options: [['seq', '按顺序'], ['random', '随机']], default: 'seq' },
    { key: 'subPos', label: '字幕位置', type: 'segment', when: (p) => String(p.subtitles ?? '').trim() !== '', options: [['top', '靠上'], ['middle', '居中'], ['bottom', '靠下']], default: 'bottom' },
    { key: 'seed', label: '随机种子（可选）', type: 'text', default: '', placeholder: '留空每次不同', help: '填同样的种子和素材，会得到同样的组合，方便复现；每次完成后会告诉你本次用的种子' },
    { key: 'out', label: '保存到', type: 'folder', default: '' },
  ],
  async run(item: InputItem, ctx) {
    if (!item.path) throw new Error('缺少素材路径');
    const duration = await ctx.duration(item.path);
    if (!(duration > 0)) throw new Error('读不出视频时长，文件可能已损坏');
    let hasAudio = true;
    try {
      await ctx.ffmpeg(['-i', item.path, '-map', '0:a:0', '-t', '0.05', '-f', 'null', '-']);
    } catch {
      hasAudio = false;
    }
    const data: ClipData = { path: item.path, duration, hasAudio };
    return { summary: `${GROUP_LABEL[groupOf(item.path)]} · ${duration.toFixed(1)} 秒${hasAudio ? '' : ' · 无音轨'}`, data };
  },
  async afterAll(results, ctx) {
    const clips: Clip[] = results
      .map((r) => r.result.data as ClipData | undefined)
      .filter((d): d is ClipData => !!d && d.duration > 0)
      .map((d) => ({ ...d, group: groupOf(d.path) }));
    if (!clips.length) return;
    const p = ctx.params;
    const seedText = String(p.seed ?? '');
    const seed = parseSeed(seedText) ?? (deps.now().getTime() % 1_000_000_000);
    const segMin = Number(p.segMin);
    const segMax = Number(p.segMax);
    const plan = planBatch(clips, { count: Number(p.count), total: Number(p.total), segMin, segMax, seed });
    const { w, h } = sizeFor(String(p.ratio) as RatioKey, String(p.res) as ResKey);
    const lines = parseLines(String(p.subtitles ?? ''));
    const subs = assignSubtitles(lines, plan.videos.length, String(p.subOrder) === 'random' ? 'random' : 'seq', makeRng(seed ^ 0x9e3779b9));
    const music = String(p.music ?? '') || undefined;
    const now = deps.now();
    const n = plan.videos.length;
    let made = 0;
    const failed: string[] = [];
    for (let i = 0; i < n; i++) {
      if (ctx.signal.aborted) break;
      const out = await ctx.join(ctx.outputDir, outputName(now, i));
      let subPng = '';
      try {
        if (subs[i]) {
          subPng = out.replace(/\.mp4$/, '') + '-字幕层.png';
          await ctx.writeFile(subPng, await deps.renderSubtitle(subs[i], w, h, String(p.subPos) as SubPos));
        }
        const { args, total } = buildArgs({
          segments: plan.videos[i].segments, w, h, keepAudio: !!p.keepAudio, music, volume: Number(p.volume ?? 70),
          subtitlePng: subPng || undefined, out,
        });
        await ctx.ffmpeg(args, (s) => ctx.progress(Math.min(0.99, (i + Math.min(1, s / total)) / n)));
        made++;
      } catch (e) {
        failed.push(`第 ${i + 1} 条：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (subPng) await deps.remove(subPng);
      }
    }
    const parts = [`已生成 ${made} 条混剪（${w}×${h}，每条约 ${Number(p.total)} 秒，${plan.midPer} 个中段片段）→ ${ctx.outputDir}，随机种子 ${seed}`];
    if (plan.warning) parts.push(plan.warning);
    if (failed.length) throw new Error(parts.join('；') + '。失败：' + failed.join(' / '));
    return parts.join('。');
  },
};

export default tool;
