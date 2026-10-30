// 浏览器 overlay 的操作授权卡片（client 半侧）。
//
// 与桌面 helper 用同一份 `shared/approval` 形状与 `APPROVAL_CSS`：host 把 approval/request
// 投影成 `sections.approval.pending[]`，两端都只读这一份。本文件是纯展示组件——
// 忙/错状态与 POST 由 pet.ts 的容器持有（与余额/说话同一套“容器统一轮询”结构）。
import { APPROVAL_CSS, approvalQueueText, type ApprovalItem } from '../shared/approval';
import type { ReactElement } from 'react';
import type { jsx } from 'react/jsx-runtime';

/** `h` = react/jsx-runtime 的 jsx（由 app.ts 注入，client 半侧不能顶层 import react）。 */
type H = typeof jsx;

let cssInjected = false;

/** 注入共享卡片样式：同页重复执行（HMR / 多 bundle）时按标记去重，不叠加 <style>。 */
export function ensureApprovalCss(): void {
  if (cssInjected || typeof document === 'undefined') return;
  if (document.querySelector('style[data-dsh-pet-approval]') !== null) {
    cssInjected = true;
    return;
  }
  cssInjected = true;
  const tag = document.createElement('style');
  tag.dataset.dshPetApproval = '1';
  tag.textContent = APPROVAL_CSS;
  document.head.appendChild(tag);
}

export interface ApprovalCardProps {
  item: ApprovalItem;
  /** 队列总数（>1 时显示“还有 N 条”）。 */
  count: number;
  busy: boolean;
  error: string;
  onAnswer: (decision: 'allowed-once' | 'rejected') => void;
}

/**
 * 卡片组件：挂在宠物头顶上方（与桌面同一套 CSS/坐标语义）。
 * 只负责渲染；点击只回调容器，容器再统一 POST /approval/answer。
 */
export function makeApprovalCard(h: H): (props: ApprovalCardProps) => ReactElement {
  return function ApprovalCard(props: ApprovalCardProps): ReactElement {
    const { item, count, busy, error, onAnswer } = props;
    const session = item.sessionId ? String(item.sessionId).slice(-6) : '';
    const subParts: Array<string | ReactElement> = [
      '工具 ',
      h('span', { className: 'dsh-pet-approval-tool', children: item.toolName }, 'tool'),
    ];
    if (session) subParts.push(' · 会话 ' + session);
    const queue = approvalQueueText(count);
    if (queue) subParts.push(' · ' + queue);
    return h('div', {
      className: 'dsh-pet-approval' + (busy ? ' is-answering' : '') + (error ? ' is-error' : ''),
      role: 'dialog',
      'aria-live': 'polite',
      style: { display: 'block' },
      onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
      children: [
        h('div', { className: 'dsh-pet-approval-head', children: [
          h('div', { className: 'dsh-pet-approval-mark', children: '!' }, 'mark'),
          h('div', { className: 'dsh-pet-approval-headtext', children: [
            h('div', { className: 'dsh-pet-approval-title', children: '需要你的授权' }, 'title'),
            h('div', { className: 'dsh-pet-approval-sub', children: subParts }, 'sub'),
          ] }, 'headtext'),
        ] }, 'head'),
        h('div', { className: 'dsh-pet-approval-reason', children: item.reason }, 'reason'),
        item.detail ? h('div', { className: 'dsh-pet-approval-detail', children: item.detail }, 'detail') : null,
        h('div', { className: 'dsh-pet-approval-actions', children: [
          h('button', {
            type: 'button',
            className: 'dsh-pet-approval-btn dsh-pet-approval-deny',
            disabled: busy,
            onClick: () => onAnswer('rejected'),
            children: '拒绝',
          }, 'deny'),
          h('button', {
            type: 'button',
            className: 'dsh-pet-approval-btn dsh-pet-approval-allow',
            disabled: busy,
            onClick: () => onAnswer('allowed-once'),
            children: '同意',
          }, 'allow'),
        ] }, 'actions'),
        h('div', {
          className: 'dsh-pet-approval-hint',
          children: error || (busy ? '已提交，等待生效…' : '同意仅对本次操作生效'),
        }, 'hint'),
      ],
    });
  };
}
