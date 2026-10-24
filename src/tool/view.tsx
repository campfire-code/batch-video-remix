// 素材卡片（登记结果）与空状态示意
import { Volume2, VolumeX } from 'lucide-react';
import type { InputItem, ItemResult } from '../kit/types';
import { groupOf } from './core';
import './view.css';

const LABEL = { head: '开头', mid: '中段', tail: '结尾' } as const;

export function ResultBody({ result }: { item: InputItem; result: ItemResult }) {
  const d = result.data as { path: string; duration: number; hasAudio: boolean } | undefined;
  if (!d) return <span className="vr-plain">{result.summary}</span>;
  const g = groupOf(d.path);
  return (
    <div className={`vr-strip g-${g}`}>
      <span className="vr-tag">{LABEL[g]}</span>
      <span className="vr-dur"><b className="k-num">{d.duration.toFixed(1)}</b><small>秒</small></span>
      <span className="vr-audio" title={d.hasAudio ? '有音轨' : '没有音轨，合成时补静音'}>{d.hasAudio ? <Volume2 size={14} /> : <VolumeX size={14} />}{d.hasAudio ? '有声' : '无声，补静音'}</span>
    </div>
  );
}

const Reel = ({ x, y, parts }: { x: number; y: number; parts: ('h' | 'm' | 't')[] }) => {
  let at = x;
  return (
    <g>
      <rect x={x - 6} y={y - 6} width={176} height={32} rx={8} className="v-box" />
      {parts.map((p, i) => {
        const w = p === 'm' ? 36 : 30;
        const r = <rect key={i} x={at} y={y} width={w - 3} height={20} rx={4} className={`v-${p}`} />;
        at += w;
        return r;
      })}
    </g>
  );
};

export function Empty({ hover }: { hover: boolean }) {
  return (
    <div className={`vr-empty${hover ? ' hover' : ''}`}>
      <svg className="vr-art" viewBox="0 0 560 220" role="img" aria-label="三个文件夹里的素材随机拼成多条不同的短视频">
        {([['开头', 'h', 2], ['中段', 'm', 4], ['结尾', 't', 2]] as const).map(([label, k, n], i) => (
          <g key={label} transform={`translate(${i * 84} 0)`}>
            <text x="34" y="26" textAnchor="middle" className="v-title">{label}</text>
            {Array.from({ length: n }, (_, j) => <rect key={j} x="6" y={38 + j * 36} width="56" height="28" rx="6" className={`v-${k}`} style={{ opacity: 1 - j * 0.15 }} />)}
            <text x="34" y="205" textAnchor="middle" className="v-sub">{n} 个素材</text>
          </g>
        ))}
        <g className="v-arrow"><path d="M268 110h44" /><path d="M303 100l11 10-11 10" /></g>
        <text x="454" y="26" textAnchor="middle" className="v-title">每次随机抽取</text>
        <Reel x={366} y={46} parts={['h', 'm', 'm', 'm', 't']} />
        <Reel x={366} y={96} parts={['h', 'm', 'm', 'm', 't']} />
        <Reel x={366} y={146} parts={['h', 'm', 'm', 'm', 't']} />
        <text x="454" y="205" textAnchor="middle" className="v-sub">几十条组合各不相同</text>
      </svg>
      <h2>素材分三段，随机拼出一批短视频</h2>
      <p>把素材放进名字带「开头」「中段」「结尾」的三个文件夹，一起拖进来。每条成片先放一个开头，再随机取几个中段，最后接结尾。</p>
    </div>
  );
}
