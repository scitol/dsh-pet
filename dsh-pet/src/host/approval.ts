/**
 * 操作授权（approval）的宿主侧转接：把 DSH 的 `approval/request` 瀑布接到桌宠上。
 *
 * 为什么要 host 接而不是浏览器 client 接：
 *   - 用户可能只显示桌面宠物（`display: "desktop"`），此时页面里的官方审批面板不可见；
 *   - 桌面 helper 是一个独立 Electron 窗口，只能经 host 的 `/state` 与 `/approval/answer`
 *     和这里通信——host 是两端唯一共同点。
 *
 * 接法（见 index.ts 的 `approval/request` 监听）：
 *   - 只有在“至少一端（web / desktop）仍在轮询、且配置里确有该端的宠物”时才接；
 *     否则 `next()` 交还给官方 remote 审批通道（不改变原有行为）；
 *   - 接了以后返回一个 pending Promise，用户点「同意 / 拒绝」时经 `/approval/answer`
 *     解析成 `allowed-once` / `rejected`；请求 signal 中止时解析成 `cancelled`；
 *   - 待处理快照写进 `sections.approval`，两端读同一份——先点的一端起效，另一端随
 *     `/state` 变化收起卡片。
 *
 * 这里只管 id / 队列 / 超时与取消，不 import 任何 DSH 包（宿主单文件加载约束）。
 */

/** 用户能给出的两种决定；其余结果（cancelled / unavailable）由取消或框架产生。 */
export type ApprovalDecision = 'allowed-once' | 'rejected';

/** DSH 审批请求里桌宠需要的字段（其它字段不投影，尤其不把 agent 对象写进 /state）。 */
export interface ApprovalAsk {
  toolName: string;
  callId?: string;
  reason?: string;
  /** `{ zh, en }` 或已本地化的字符串；host 只取中文/英文文案，不把对象塞给前端。 */
  displayReason?: unknown;
  signal?: AbortSignal;
  sessionId?: string;
  /** 工具调用参数的一行/几行预览（命令、路径……），由 index.ts 从会话日志里找。 */
  detail?: string;
}

/** 写进 `sections.approval.pending[]` 的公开形状（JSON 安全、不含 agent/signal）。 */
export interface ApprovalView {
  id: string;
  toolName: string;
  reason: string;
  detail?: string;
  sessionId?: string;
  createdAt: number;
}

interface PendingEntry {
  view: ApprovalView;
  settle: (outcome: 'allowed-once' | 'rejected' | 'cancelled') => void;
}

/** 最多同时保留多少条：超出时新的请求直接拒绝（fail closed），不让 UI/队列无限膨胀。 */
const MAX_PENDING = 8;
/** 单条 detail 的字符上限：卡片只有几行，超长命令没必要整段塞进 /state。 */
const DETAIL_MAX_CHARS = 600;

/** 把任意 `displayReason` 收敛成一句人话（中文优先，其次英文，最后原始 reason）。 */
function humanReason(ask: ApprovalAsk): string {
  const pick = (v: unknown): string | undefined => {
    if (typeof v === 'string' && v.trim()) return v.trim();
    return undefined;
  };
  const direct = pick(ask.displayReason);
  if (direct) return direct;
  if (ask.displayReason && typeof ask.displayReason === 'object') {
    const localized = ask.displayReason as { zh?: unknown; en?: unknown };
    const zh = pick(localized.zh);
    if (zh) return zh;
    const en = pick(localized.en);
    if (en) return en;
  }
  const raw = pick(ask.reason);
  if (raw) return raw;
  return `工具 ${ask.toolName} 请求执行一次需要授权的操作。`;
}

/** detail 截断：保留前 DETAIL_MAX_CHARS 个字符（按码点，避免切坏 emoji）。 */
export function truncateDetail(text: string): string {
  const chars = Array.from(text);
  return chars.length > DETAIL_MAX_CHARS ? chars.slice(0, DETAIL_MAX_CHARS).join('') + '…' : text;
}

/**
 * 待处理审批队列。纯内存、进程内；插件卸载时 `cancelAll()` 把等待者解析成 cancelled，
 * 不让 DSH 的 tool 调用悬着。
 */
export class ApprovalBroker {
  declare private readonly pending: Map<string, PendingEntry>;
  declare private seq: number;
  /** 每次队列变化后调用，把最新快照写进 `sections.approval`。 */
  declare private readonly publish: (views: ApprovalView[]) => void;

  /**
   * @param publish - 每次队列变化后调用，把最新快照写进 `sections.approval`。
   */
  constructor(publish: (views: ApprovalView[]) => void) {
    this.publish = publish;
    this.pending = new Map();
    this.seq = 0;
  }

  /** 当前快照（按到达顺序）。 */
  views(): ApprovalView[] {
    return [...this.pending.values()].map((entry) => entry.view);
  }

  /**
   * 接住一条请求，返回一个等到用户决定（或请求中止）才解析的 Promise。
   * 队列已满时立刻返回 `unavailable`（fail closed，与官方“没有可用 answerer”同义）。
   */
  request(ask: ApprovalAsk): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'> {
    if (this.pending.size >= MAX_PENDING) return Promise.resolve('unavailable');
    const id = `approval-${Date.now().toString(36)}-${(++this.seq).toString(36)}`;
    return new Promise((resolve) => {
      let settled = false;
      const onAbort = (): void => settle('cancelled');
      const cleanup = (): void => {
        ask.signal?.removeEventListener('abort', onAbort);
      };
      const settle = (outcome: 'allowed-once' | 'rejected' | 'cancelled'): void => {
        if (settled) return;
        settled = true;
        cleanup();
        this.pending.delete(id);
        this.publish(this.views());
        resolve(outcome);
      };
      const view: ApprovalView = {
        id,
        toolName: ask.toolName,
        reason: humanReason(ask),
        ...(ask.detail ? { detail: truncateDetail(ask.detail) } : {}),
        ...(ask.sessionId ? { sessionId: ask.sessionId } : {}),
        createdAt: Date.now(),
      };
      this.pending.set(id, { view, settle });
      if (ask.signal) {
        ask.signal.addEventListener('abort', onAbort, { once: true });
        if (ask.signal.aborted) {
          onAbort();
          return;
        }
      }
      this.publish(this.views());
    });
  }

  /**
   * 回答一条待处理请求。
   * @returns `ok:false, reason:'stale'` 表示它已经被另一端回答 / 已中止 / id 不存在。
   */
  answer(id: string, decision: ApprovalDecision): { ok: boolean; reason?: string } {
    const entry = this.pending.get(id);
    if (!entry) return { ok: false, reason: 'stale' };
    entry.settle(decision);
    return { ok: true };
  }

  /** 插件卸载 / 宿主退出：所有等待者按 cancelled 收尾。 */
  cancelAll(): void {
    for (const entry of [...this.pending.values()]) entry.settle('cancelled');
  }
}
