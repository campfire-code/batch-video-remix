// 纯函数：随机组合规划、去重、时长分配、ffmpeg 参数生成。不依赖界面和本机能力，便于单元测试。
// 独立实现：思路来自常见的「按组随机抽片段再拼接」玩法，未参考或复制任何第三方混剪项目的代码。

export type RatioKey = '9:16' | '1:1' | '16:9';
export type ResKey = '720' | '1080';
export const FPS = 30;
export const VIDEO_EXTS = ['mp4', 'mov', 'm4v', 'mkv', 'avi', 'webm'];
export const AUDIO_EXTS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg'];

/** 分辨率：短边为 720 或 1080 */
export function sizeFor(ratio: RatioKey, res: ResKey): { w: number; h: number } {
  const s = res === '720' ? 720 : 1080;
  const long = s === 720 ? 1280 : 1920;
  if (ratio === '1:1') return { w: s, h: s };
  return ratio === '9:16' ? { w: s, h: long } : { w: long, h: s };
}

// ---------- 随机数 ----------

/** 带种子的随机数（mulberry32），同一种子产生同一序列 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 种子文本转数字：纯数字直接用，其他文字按字符散列；空串返回 undefined（调用方自己取时间） */
export function parseSeed(text: string): number | undefined {
  const s = text.trim();
  if (!s) return undefined;
  if (/^\d{1,10}$/.test(s)) return Number(s) >>> 0;
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const randInt = (rng: () => number, n: number) => Math.min(n - 1, Math.floor(rng() * n));
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 素材分组 ----------

export type Group = 'head' | 'mid' | 'tail';
export interface Clip {
  path: string;
  /** 素材时长（秒） */
  duration: number;
  hasAudio: boolean;
  group: Group;
}

const HEAD_WORDS = ['开头', '片头', '头部', '前段', '开场', 'head', 'intro', 'start', 'opening'];
const TAIL_WORDS = ['结尾', '片尾', '尾部', '后段', '收尾', 'tail', 'outro', 'end', 'ending'];

/** 按「所在文件夹名」分组：含开头类词语为开头，含结尾类词语为结尾，其余为中段 */
export function groupOf(path: string): Group {
  const parts = path.replace(/\\/g, '/').split('/');
  const dir = (parts[parts.length - 2] ?? '').toLowerCase();
  if (HEAD_WORDS.some((w) => dir.includes(w))) return 'head';
  if (TAIL_WORDS.some((w) => dir.includes(w))) return 'tail';
  return 'mid';
}

// ---------- 时长分配 ----------

/** 把 total 秒拆成 n 段，每段在 [min, max] 内，随机分配，保留一位小数，总和等于 total（total 不在可行范围时取最近的可行值） */
export function splitDuration(total: number, n: number, min: number, max: number, rng: () => number): number[] {
  if (n < 1) return [];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const sum = Math.min(n * hi, Math.max(n * lo, total));
  const out = Array.from({ length: n }, () => lo);
  let rest = Math.round((sum - n * lo) * 10); // 以 0.1 秒为单位
  const cap = out.map(() => Math.round((hi - lo) * 10));
  while (rest > 0) {
    const open = out.map((_, i) => i).filter((i) => cap[i] > 0);
    if (!open.length) break;
    const i = open[randInt(rng, open.length)];
    const step = Math.min(cap[i], rest, 1 + randInt(rng, 8));
    out[i] = r1(out[i] + step / 10);
    cap[i] -= step;
    rest -= step;
  }
  return out;
}

/** 中段片段数：按目标时长和平均片段长度估算，至少 1，不超过可选素材数 */
export function midCount(total: number, headTail: number, min: number, max: number, available: number): number {
  const avg = (min + max) / 2 || 1;
  return Math.max(1, Math.min(available, Math.round((total - headTail) / avg)));
}

// ---------- 组合数与规划 ----------

/** 从 m 个里按顺序取 n 个的排列数 */
export function permutations(m: number, n: number): number {
  if (n > m) return 0;
  let r = 1;
  for (let i = 0; i < n; i++) r *= m - i;
  return r;
}

export interface Segment {
  path: string;
  start: number;
  dur: number;
  hasAudio: boolean;
}
export interface VideoPlan {
  segments: Segment[];
  /** 组合签名：只看用了哪些素材、什么顺序，用于去重 */
  signature: string;
  total: number;
}

export interface PlanOptions {
  count: number;
  /** 每条视频目标总时长（秒） */
  total: number;
  segMin: number;
  segMax: number;
  seed: number;
}
export interface PlanResult {
  videos: VideoPlan[];
  /** 不重复的组合上限 */
  capacity: number;
  /** 比要求的条数少时的说明 */
  warning?: string;
  /** 中段每条取几个片段 */
  midPer: number;
}

function cut(clip: Clip, want: number, rng: () => number): Segment {
  const dur = r1(Math.min(want, clip.duration));
  const start = r1(rng() * Math.max(0, clip.duration - dur));
  return { path: clip.path, start: Math.min(start, r1(Math.max(0, clip.duration - dur))), dur, hasAudio: clip.hasAudio };
}

/** 枚举所有排列（上限 limit 个，防止爆炸） */
function* arrangements<T>(items: T[], n: number): Generator<T[]> {
  const used = new Array(items.length).fill(false);
  const cur: T[] = [];
  function* go(): Generator<T[]> {
    if (cur.length === n) { yield cur.slice(); return; }
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      used[i] = true; cur.push(items[i]);
      yield* go();
      cur.pop(); used[i] = false;
    }
  }
  yield* go();
}

/**
 * 规划整批视频：每条 = [开头 1 段] + 中段若干段 + [结尾 1 段]；没有开头/结尾素材时对应部分省略。
 * 同一批里素材组合（用了哪些素材、什么顺序）不重复；组合数不足时只生成能生成的条数并给出 warning。
 */
export function planBatch(clips: Clip[], opt: PlanOptions): PlanResult {
  const heads = clips.filter((c) => c.group === 'head');
  const mids = clips.filter((c) => c.group === 'mid');
  const tails = clips.filter((c) => c.group === 'tail');
  // 没有中段素材时，用开头和结尾以外的任何素材都没得用：报错交给调用方
  if (!mids.length) throw new Error('没有「中段」素材：不在开头/结尾文件夹里的视频都算中段，至少需要 1 个');
  const rng = makeRng(opt.seed);
  const headTail = (heads.length ? 1 : 0) + (tails.length ? 1 : 0);
  const midPer = midCount(opt.total, headTail * ((opt.segMin + opt.segMax) / 2), opt.segMin, opt.segMax, mids.length);
  const capacity = Math.max(1, heads.length) * Math.max(1, tails.length) * permutations(mids.length, midPer);
  const want = Math.max(0, Math.floor(opt.count));
  const n = Math.min(want, capacity);

  const build = (h: Clip | undefined, m: Clip[], t: Clip | undefined): VideoPlan => {
    const parts = [h, ...m, t].filter((c): c is Clip => !!c);
    const durs = splitDuration(opt.total, parts.length, opt.segMin, opt.segMax, rng);
    const segments = parts.map((c, i) => cut(c, durs[i], rng));
    return { segments, signature: parts.map((c) => c.path).join('>'), total: r1(segments.reduce((a, s) => a + s.dur, 0)) };
  };

  const videos: VideoPlan[] = [];
  const seen = new Set<string>();
  if (capacity <= 5000) {
    // 组合少：全部列出来打乱再取，保证取得出 n 条
    const all: [Clip | undefined, Clip[], Clip | undefined][] = [];
    for (const h of heads.length ? heads : [undefined]) for (const t of tails.length ? tails : [undefined]) for (const m of arrangements(mids, midPer)) all.push([h, m, t]);
    for (const [h, m, t] of shuffle(all, rng).slice(0, n)) videos.push(build(h, m, t));
  } else {
    let tries = 0;
    while (videos.length < n && tries++ < n * 100) {
      const h = heads.length ? heads[randInt(rng, heads.length)] : undefined;
      const t = tails.length ? tails[randInt(rng, tails.length)] : undefined;
      const v = build(h, shuffle(mids, rng).slice(0, midPer), t);
      if (seen.has(v.signature)) continue;
      seen.add(v.signature);
      videos.push(v);
    }
  }
  const warning = videos.length < want
    ? `素材组合数只有 ${capacity} 种，不足 ${want} 条，只生成了 ${videos.length} 条（同一批里组合不重复）。可增加素材、减小每条总时长或加大片段时长。`
    : undefined;
  return { videos, capacity, warning, midPer };
}

// ---------- 字幕文案 ----------

export function parseLines(text: string): string[] {
  return text.replace(/\r/g, '').split('\n').map((s) => s.trim()).filter(Boolean);
}

/** 给每条视频分配一句文案：顺序 = 依次循环；随机 = 洗牌后依次取，取完再洗，相邻轮次尽量不连续重复 */
export function assignSubtitles(lines: string[], count: number, mode: 'seq' | 'random', rng: () => number): string[] {
  if (!lines.length) return Array(count).fill('');
  if (mode === 'seq') return Array.from({ length: count }, (_, i) => lines[i % lines.length]);
  const out: string[] = [];
  let bag: string[] = [];
  while (out.length < count) {
    if (!bag.length) {
      bag = shuffle(lines, rng);
      if (lines.length > 1 && out.length && bag[0] === out[out.length - 1]) bag.push(bag.shift()!);
    }
    out.push(bag.shift()!);
  }
  return out;
}

// ---------- ffmpeg 参数 ----------

export interface Job {
  segments: Segment[];
  w: number;
  h: number;
  /** 保留素材原声 */
  keepAudio: boolean;
  music?: string;
  /** 0-100 */
  volume: number;
  /** 字幕层 PNG（与画面同尺寸的透明图） */
  subtitlePng?: string;
  out: string;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function totalOf(segments: Segment[]): number {
  return r2(segments.reduce((a, s) => a + s.dur, 0));
}

/**
 * 每个片段先用 -ss/-t 在输入端截取，再统一缩放裁切到目标画幅（铺满，多出的部分裁掉）、统一帧率，最后 concat。
 * 保留原声时，没有音轨的素材补静音，保证拼接不出错。
 */
export function buildArgs(job: Job): { args: string[]; total: number } {
  const { segments: segs, w, h } = job;
  if (!segs.length) throw new Error('至少需要 1 个片段');
  const total = totalOf(segs);
  const args: string[] = [];
  for (const s of segs) args.push('-ss', String(s.start), '-t', String(s.dur), '-i', s.path);
  let idx = segs.length;
  const subIdx = job.subtitlePng ? idx++ : -1;
  if (job.subtitlePng) args.push('-i', job.subtitlePng);
  const musicIdx = job.music ? idx++ : -1;
  if (job.music) args.push('-stream_loop', '-1', '-i', job.music);

  const parts: string[] = [];
  segs.forEach((s, i) => {
    parts.push(`[${i}:v:0]setpts=PTS-STARTPTS,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${FPS},format=yuv420p[v${i}]`);
    if (job.keepAudio) {
      parts.push(s.hasAudio
        ? `[${i}:a:0]asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${s.dur}[a${i}]`
        : `anullsrc=r=44100:cl=stereo,atrim=0:${s.dur},asetpts=PTS-STARTPTS[a${i}]`);
    }
  });
  const inputs = segs.map((_, i) => `[v${i}]${job.keepAudio ? `[a${i}]` : ''}`).join('');
  parts.push(`${inputs}concat=n=${segs.length}:v=1:a=${job.keepAudio ? 1 : 0}[vc]${job.keepAudio ? '[ac]' : ''}`);
  let vLabel = 'vc';
  if (job.subtitlePng) {
    parts.push(`[vc][${subIdx}:v]overlay=0:0:format=auto,format=yuv420p[vs]`);
    vLabel = 'vs';
  }
  let aLabel: string | undefined = job.keepAudio ? 'ac' : undefined;
  if (job.music) {
    const fade = r2(Math.min(2, total / 2));
    const vol = r2(Math.min(100, Math.max(0, job.volume)) / 100);
    parts.push(`[${musicIdx}:a]atrim=0:${total},asetpts=PTS-STARTPTS,afade=t=out:st=${r2(total - fade)}:d=${fade},volume=${vol}[am]`);
    if (job.keepAudio) {
      parts.push('[ac][am]amix=inputs=2:duration=first:normalize=0[aout]');
      aLabel = 'aout';
    } else aLabel = 'am';
  }
  args.push('-filter_complex', parts.join(';'), '-map', `[${vLabel}]`);
  if (aLabel) args.push('-map', `[${aLabel}]`);
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(FPS));
  if (aLabel) args.push('-c:a', 'aac', '-b:a', '160k');
  args.push('-movflags', '+faststart', '-t', String(total), job.out);
  return { args, total };
}

export const outputName = (d: Date, i: number): string => {
  const p = (v: number, n = 2) => String(v).padStart(n, '0');
  return `混剪-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(i + 1, 3)}.mp4`;
};

// ---------- 字幕排版（画布渲染用，测量函数由外部传入便于测试） ----------

export type SubPos = 'top' | 'middle' | 'bottom';
export interface SubLayout { fontSize: number; lines: string[]; centerY: number; lineHeight: number; blockW: number; blockH: number }

/** 按宽度逐字折行；最多 maxLines 行，超出的部分以「…」截断 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number, maxLines = 2): string[] {
  const lines: string[] = [];
  for (const para of text.replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const ch of Array.from(para)) {
      if (line && measure(line + ch) > maxWidth) { lines.push(line); line = ch; } else line += ch;
    }
    if (line) lines.push(line);
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && measure(last + '…') > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = last + '…';
  return kept;
}

export function layoutSubtitle(text: string, w: number, h: number, pos: SubPos, measureAt: (fontSize: number) => (s: string) => number): SubLayout {
  const fontSize = Math.round(Math.min(w, h) * 0.06);
  const maxWidth = w * 0.84;
  const measure = measureAt(fontSize);
  const lines = wrapText(text.trim(), maxWidth, measure);
  const lineHeight = Math.round(fontSize * 1.35);
  const blockH = lines.length * lineHeight;
  const blockW = Math.min(maxWidth, Math.max(...lines.map(measure), 0));
  const centerY = pos === 'top' ? h * 0.1 + blockH / 2 : pos === 'middle' ? h / 2 : h - h * 0.14 - blockH / 2;
  return { fontSize, lines, centerY: Math.round(centerY), lineHeight, blockW, blockH };
}
