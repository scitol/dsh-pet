// 操作授权（approval）的客户端视图：host 把待处理的 approval/request 投影到
// `sections.approval`，浏览器 overlay 与桌面 helper 读同一份叶子，点「同意 / 拒绝」
// 都 POST 回 /approval/answer —— 两端只共享这一份形状，不各自解释 host 的原始请求。
//
// 与 state.ts 的分工：这里只做“叶子 → 视图”的收窄（形状非法 → null，消费端跳过这一拍），
// 不发请求、不碰 DOM。样式常量给桌面纯 DOM 与浏览器 React 两端共用（与 menu/chat 同一做法）。
import type { StateLeaf } from './state';

/** 一条待用户决定的操作授权。 */
export interface ApprovalItem {
  /** host 生成的稳定 id；回答时原样回传 */
  id: string;
  /** 请求授权的工具名（bash / edit / …） */
  toolName: string;
  /** 面向人的一句话（host 已把 displayReason 本地化；没有时回落到 reason） */
  reason: string;
  /** 可选的操作预览（命令 / 路径 / 参数摘要），host 已截断 */
  detail?: string;
  /** 发起请求的会话 id（只用于展示“来自哪个会话”的后 6 位） */
  sessionId?: string;
  /** host 受理时刻（ms） */
  createdAt: number;
}

/** `sections.approval` 的完整快照。pending 按到达顺序（FIFO），前端显示第一条。 */
export interface ApprovalSnapshot {
  pending: ApprovalItem[];
}

/** 最多展示/缓存多少条：超出的请求仍留在 host 队列，只是这里不显示（防御脏数据）。 */
const MAX_PENDING = 8;

/**
 * 类型收窄：approval 叶子 → 快照。
 * `pending: []` 是合法快照（表示“没有待处理”，用来清掉卡片）；形状非法 → null（跳过这一拍）。
 */
export function readApprovals(leaf: StateLeaf): ApprovalSnapshot | null {
  const data = leaf.data as { pending?: unknown } | null;
  if (!data || typeof data !== 'object' || !Array.isArray(data.pending)) return null;
  const pending: ApprovalItem[] = [];
  for (const raw of data.pending.slice(0, MAX_PENDING)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id) continue;
    if (typeof item.toolName !== 'string' || !item.toolName) continue;
    if (typeof item.reason !== 'string' || !item.reason) continue;
    pending.push({
      id: item.id,
      toolName: item.toolName,
      reason: item.reason,
      ...(typeof item.detail === 'string' && item.detail ? { detail: item.detail } : {}),
      ...(typeof item.sessionId === 'string' && item.sessionId ? { sessionId: item.sessionId } : {}),
      ...(typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? { createdAt: item.createdAt } : { createdAt: 0 }),
    });
  }
  return { pending };
}

/** “还有 N 条”计数文案；0/1 时返回空串（不占用卡片空间）。 */
export function approvalQueueText(count: number): string {
  return count > 1 ? `还有 ${count - 1} 条待处理` : '';
}

/**
 * 两端共用的卡片样式。
 *
 * 卡片挂在宠物**头顶上方**的透明余量里（`bottom: calc(100% + 10px)`），不遮住宠物。
 * 桌面端窗口上边距不够时由 sprite.js 的 `ensureApprovalVisible()` 临时加高窗口、
 * 必要时把宠物整体下移，保证卡片完整可见。尺寸锚在宠物尺寸上（`--dsh-pet-size`），
 * 字号在基准值上 +2px（用户要求调大一档）；其余层级仍用 em 相对卡片自身。
 */
export const APPROVAL_CSS = `
.dsh-pet-approval {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  transform: translateX(-50%);
  z-index: 12;
  box-sizing: border-box;
  width: min(calc(var(--dsh-pet-size, 462px) * 0.9), 420px);
  padding: 0.95em 1em 0.8em;
  border: 1px solid rgba(222, 178, 96, 0.75);
  border-radius: 1.1em;
  background: rgba(255, 252, 246, 0.98);
  box-shadow: 0 18px 40px rgba(60, 42, 12, 0.24), 0 2px 8px rgba(60, 42, 12, 0.1);
  color: #2b2b2b;
  font-family: var(--dsh-pet-font-family, 'Microsoft YaHei UI', 'Segoe UI', sans-serif);
  font-size: calc(var(--dsh-pet-size, 462px) * 0.033 + 2px);
  line-height: 1.5;
  pointer-events: auto;
  user-select: none;
  overflow: hidden;
}
.dsh-pet-approval-head { display: flex; align-items: center; gap: 0.55em; }
.dsh-pet-approval-mark {
  flex: none;
  width: 1.65em;
  height: 1.65em;
  border-radius: 50%;
  background: #f0a63a;
  color: #fff;
  font-weight: 800;
  font-size: 1em;
  line-height: 1.65em;
  text-align: center;
  box-shadow: 0 2px 6px rgba(240, 166, 58, 0.45);
}
.dsh-pet-approval-headtext { min-width: 0; flex: 1 1 auto; }
.dsh-pet-approval-title {
  margin: 0;
  font-size: 1.06em;
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-pet-approval-sub {
  margin-top: 0.1em;
  color: #8b6a35;
  font-size: 0.78em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-pet-approval-tool {
  font-family: Consolas, 'Cascadia Mono', monospace;
  color: #6b5427;
}
.dsh-pet-approval-reason {
  margin-top: 0.65em;
  max-height: 4.5em;
  overflow: auto;
  color: #3a3226;
  font-size: 0.92em;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  scrollbar-width: thin;
}
.dsh-pet-approval-detail {
  margin-top: 0.55em;
  padding: 0.5em 0.65em;
  max-height: 5.4em;
  overflow: auto;
  border-radius: 0.65em;
  background: #f4f0e8;
  color: #4a4133;
  font-family: Consolas, 'Cascadia Mono', monospace;
  font-size: 0.76em;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  scrollbar-width: thin;
}
.dsh-pet-approval-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.55em;
  margin-top: 0.85em;
}
.dsh-pet-approval-btn {
  appearance: none;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0.45em 1.1em;
  font: inherit;
  font-size: 0.92em;
  font-weight: 600;
  line-height: 1.3;
  cursor: pointer;
  transition: filter 0.15s ease, background 0.15s ease;
}
.dsh-pet-approval-btn:disabled { cursor: default; opacity: 0.55; }
.dsh-pet-approval-deny {
  background: #fff;
  border-color: #d8cfbf;
  color: #655b4a;
}
.dsh-pet-approval-deny:hover:not(:disabled) { background: #f6f1e8; }
.dsh-pet-approval-allow {
  background: #e8952f;
  color: #fff;
  box-shadow: 0 3px 10px rgba(232, 149, 47, 0.35);
}
.dsh-pet-approval-allow:hover:not(:disabled) { filter: brightness(1.06); }
.dsh-pet-approval-hint {
  margin-top: 0.45em;
  color: #96856a;
  font-size: 0.72em;
  text-align: right;
}
.dsh-pet-approval.is-answering { pointer-events: none; }
.dsh-pet-approval.is-answering .dsh-pet-approval-btn { opacity: 0.5; }
.dsh-pet-approval.is-error .dsh-pet-approval-hint { color: #c0392b; }
@media (prefers-reduced-motion: reduce) {
  .dsh-pet-approval-btn { transition: none; }
}
`;
