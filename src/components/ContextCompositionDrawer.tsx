import type { CSSProperties } from 'react';
import { X } from 'lucide-react';
import {
  hasManualReference,
  largestContextItems,
  messageFramingResidual,
} from '../contextPlan';
import type { ContextPlan, PromptCacheBand, PromptLayer } from '../types';

export type PromptCompositionItem = {
  id: string;
  layer: PromptLayer;
  title: string;
  reason: string;
  cacheBand: PromptCacheBand;
  estimatedTokens: number;
  includedNames?: string[];
};

type PromptCompositionGroup = {
  key: string;
  title: string;
  reason: string;
  estimatedTokens: number;
};

export const combinePromptSources = (items: PromptCompositionItem[]) => {
  const combined: PromptCompositionItem[] = [];
  const grouped = new Map<'character' | 'world', PromptCompositionItem>();

  items.forEach((item) => {
    if (item.layer !== 'character' && item.layer !== 'world') {
      combined.push(item);
      return;
    }

    const existing = grouped.get(item.layer);
    if (existing) {
      existing.estimatedTokens += item.estimatedTokens;
      existing.includedNames?.push(item.title);
      return;
    }

    const aggregate = {
      ...item,
      id: `combined-${item.layer}`,
      title: item.layer === 'character' ? '角色卡' : '世界观设定',
      reason: item.layer === 'character' ? '本次装入的角色设定' : '本次装入的世界设定',
      includedNames: item.id.startsWith('template-') ? undefined : [item.title],
    };
    grouped.set(item.layer, aggregate);
    combined.push(aggregate);
  });

  return combined;
};

const promptTone = (index: number) => `var(--prompt-tone-${index % 6 + 1})`;

const promptCompositionGroup = (item: PromptCompositionItem): Omit<PromptCompositionGroup, 'estimatedTokens'> => {
  if (item.layer === 'system') return { key: 'rules', title: '写作规则', reason: '本轮写作的基本指引' };
  if (item.layer === 'summary' || item.title.startsWith('REFERENCE')) {
    return { key: 'references', title: '前文梗概/全文', reason: '带入已完成前文' };
  }
  if (item.layer === 'manuscript') return { key: 'writing', title: '正在写', reason: '衔接并完成当前小节' };
  if (item.layer === 'mode' || item.layer === 'note' || item.layer === 'instruction'
    || item.title === '剧情大纲') {
    return { key: 'turn', title: '本轮指引与输入', reason: '帮助本轮推进当前小节' };
  }
  return { key: 'story', title: '故事设定', reason: '保持角色、世界和故事事实一致' };
};

export const groupPromptComposition = (items: PromptCompositionItem[]): PromptCompositionGroup[] => {
  const groups = new Map<string, PromptCompositionGroup>();
  items.forEach((item) => {
    const next = promptCompositionGroup(item);
    const existing = groups.get(next.key);
    if (existing) {
      existing.estimatedTokens += item.estimatedTokens;
      return;
    }
    groups.set(next.key, { ...next, estimatedTokens: item.estimatedTokens });
  });
  return [...groups.values()];
};

const promptShareLabel = (share: number) => (
  share < 1 ? '<1%' : share < 10 ? `${share.toFixed(1)}%` : `${Math.round(share)}%`
);

export function ContextCompositionDrawer({
  open,
  plan,
  error,
  onClose,
}: {
  open: boolean;
  plan: ContextPlan | null;
  error: string;
  onClose: () => void;
}) {
  const groupedCompositionItems = plan ? groupPromptComposition(combinePromptSources(plan.included.map((item) => ({
    id: item.id,
    layer: item.layer,
    title: item.title,
    reason: item.reason,
    cacheBand: item.cacheBand,
    estimatedTokens: item.estimatedTokens,
  })))) : [];
  const totalPromptTokens = plan?.estimatedTokens ?? 0;
  const framingResidual = plan ? messageFramingResidual(plan) : 0;
  const compositionItems = plan
    ? [...groupedCompositionItems, ...(framingResidual > 0 ? [{
        key: 'message-framing',
        title: '请求格式开销',
        reason: '发送请求所需的格式信息',
        estimatedTokens: framingResidual,
      }] : [])]
    : [];
  const largestItems = plan ? largestContextItems(plan.included) : [];
  const largestItemsLabel = plan && hasManualReference(plan.included) ? '手选前文' : '内容';

  return (
    <section
      id="context-composition-drawer"
      className="context-composition-drawer"
      data-open={open}
      aria-hidden={!open}
      inert={!open}
      aria-labelledby="context-composition-drawer-title"
    >
      <div className="context-composition-scroll">
        <header className="drawer-heading">
          <div>
            <h2 id="context-composition-drawer-title">本轮上下文概览</h2>
            {plan && <small>内容占比 · 总量约 {plan.estimatedTokens.toLocaleString()} tokens</small>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭本轮上下文概览" title="关闭">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="prompt-composition-content">
          {error ? <p className="context-preview-error" role="alert">{error}</p> : plan && <div className="prompt-composition-chart">
            {plan.budget.overflow && <p className="context-preview-error" role="alert">
              上下文预算不足：约超出 {plan.budget.overflowTokens.toLocaleString()} tokens，仅供参考，仍可发送。占用较大的{largestItemsLabel}：{largestItems.map((item) => `${item.title}（约 ${item.estimatedTokens.toLocaleString()} tokens）`).join('、') || '当前输入'}。
            </p>}
            <div className="prompt-composition-map">
              <div className="prompt-proportion-bar" aria-hidden="true">
                {compositionItems.map((item, index) => {
                  const share = totalPromptTokens > 0 ? item.estimatedTokens / totalPromptTokens * 100 : 0;
                  return <span className="prompt-proportion-segment" key={item.key} style={{ '--prompt-color': promptTone(index), flexGrow: Math.max(item.estimatedTokens, 0.01) } as CSSProperties} />;
                })}
              </div>
              <ol className="prompt-composition-list" aria-label="本轮上下文内容占比">
                {compositionItems.map((item, index) => {
                  const share = totalPromptTokens > 0 ? item.estimatedTokens / totalPromptTokens * 100 : 0;
                  return <li key={item.key} style={{ '--prompt-color': promptTone(index) } as CSSProperties}>
                    <span className="prompt-composition-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="prompt-composition-copy"><span className="prompt-composition-title-row"><strong>{item.title}</strong><span className="prompt-composition-meta"><strong>{promptShareLabel(share)}</strong><small>约 {item.estimatedTokens.toLocaleString()} tokens</small></span></span><small>{item.reason}</small></span>
                  </li>;
                })}
              </ol>
            </div>
          </div>}
        </div>
      </div>
    </section>
  );
}
