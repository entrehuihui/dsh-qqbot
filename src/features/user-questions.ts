/**
 * QQ 端 userQuestions answerer — 提问渲染与答案收集
 *
 * 将 QQ 会话里 `ask_user_question` 的提问渲染成 QQ 卡片（markdown + 键盘按钮），
 * 主人点按钮或回复文字即可回答，不再卡死在 web 端。
 *
 * 设计要点（适配 dsh 0.1.5 的 scoped waterfall API）：
 * - dsh 0.1.5 起 `@deepseek-ai/dsh-user-questions` 由「Provider 注册」改为
 *   「scoped waterfall 事件」：UserQuestionService.ask() 内部通过
 *   `ctx.waterfall(scopeTarget(agent, agent), 'user-questions/request',
 *   {...request, agent}, noAnswerer)` 分发。answerer 不再调用 registerProvider
 *   （新版 Service 上该方法已不存在），而是监听 `user-questions/request` 事件，
 *   handler 签名 `(request, next)`：不调 next() 且返回 Promise 即消费，调 next()
 *   放行给下一个 answerer（web 弹窗）。
 * - 本插件在插件 root ctx 注册监听器；scopeTarget 的 filter 对无 scope tag 的
 *   root 监听器永远放行，因此能收到所有 QQ agent 的 scoped 提问事件，再用
 *   `manager.findByAgent(agent)` 校验该 agent 是否属于本插件管理的 QQ 会话。
 * - pending 按 `agent.id` 键控，多问题逐个回答，全部答完才 resolve。
 * - 按钮 data 编码 `uq:<agentId>:<qi>:<oi>`，interaction 分流时按 agentId 双保险校验。
 * - 超时（questionTimeoutMs）与 request.signal abort 均 reject `ASK_ABORTED`。
 * - 卡片发送失败降级纯文字提问，仍挂 pending 等文字答案。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { QQBot } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.js';
import type { SessionManager, SessionRecord } from '../session/index.js';
import type { DshAgent } from '../session/types.js';
import type { Logger } from '../types.js';
import { buildKeyboard } from '../tools/qq-card.js';

// ── userQuestions 协议类型（与 @deepseek-ai/dsh-user-questions 的类型对齐，避免引入非 peer 依赖） ──

export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

export interface AskUserQuestionItem {
  id: string;
  question: string;
  detail?: string;
  header?: string;
  options?: AskUserQuestionOption[];
  multiSelect?: boolean;
  intent?: { kind: string; approve?: string };
}

export interface AskUserQuestionAnswerItem {
  id: string;
  selected: string[];
  custom?: string;
}

export interface AskUserQuestionAnswer {
  answers: AskUserQuestionAnswerItem[];
}

export interface AskUserQuestionRequest {
  questions: AskUserQuestionItem[];
  agent?: DshAgent;
  signal?: AbortSignal;
}

/** 一次挂起的提问（一个 ask 调用） */
interface PendingQuestion {
  agentId: string;
  record: SessionRecord;
  questions: AskUserQuestionItem[];
  /** 每个问题的答案，未答为 undefined */
  answers: (AskUserQuestionAnswerItem | undefined)[];
  resolve: (answer: AskUserQuestionAnswer) => void;
  reject: (err: unknown) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/** 与 @deepseek-ai/dsh-user-questions 的 UserQuestionError 语义一致的本地错误（带 code） */
export class UserQuestionError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'UserQuestionError';
    this.code = code;
  }
}

/** 按钮 data 前缀：`uq:<agentId>:<qi>:<oi>` */
const BUTTON_PREFIX = 'uq:';

export class UserQuestionsFeature {
  /** agentId → PendingQuestion */
  private readonly pending = new Map<string, PendingQuestion>();

  constructor(
    private readonly ctx: Context,
    private readonly manager: SessionManager,
    private readonly bot: QQBot,
    private readonly config: ImQQBotConfig,
    private readonly logger: Logger,
  ) {
    this.registerAnswerer();
    this.teardown();
  }

  // ── waterfall answerer 注册 ──

  /**
   * 在插件 root ctx 注册 `user-questions/request` waterfall 监听器。
   *
   * dsh 0.1.5 起 userQuestions 由「Provider 注册」改为「scoped waterfall 事件」：
   * UserQuestionService.ask() 内部通过 `ctx.waterfall(scopeTarget(agent, agent),
   * 'user-questions/request', {...request, agent}, noAnswerer)` 分发。root ctx 的
   * 监听器能收到 scoped 事件（scopeTarget 的 filter 对无 scope tag 的 root
   * 监听器永远放行，与 api-remotes 转发端同款注册方式）。handler 签名
   * `(request, next)`：不调 next() 且返回 Promise 即消费；调 next() 放行给
   * 下一个 answerer（web 弹窗）。
   */
  private registerAnswerer(): void {
    (this.ctx as unknown as { on(event: string, handler: (request: unknown, next: () => unknown) => unknown): unknown })
      .on('user-questions/request', (request: unknown, next: () => unknown) => {
        const agent = (request as { agent?: DshAgent }).agent;
        // 只响应属于本插件的 QQ 会话 agent；不是则放行（web answerer 会处理）
        if (agent === undefined || this.manager.findByAgent(agent) === undefined) return next();
        return this.ask(request as AskUserQuestionRequest);
      });
  }

  /** 插件卸载时，对全部挂起提问 reject ASK_ABORTED（同 web answerer 行为） */
  private teardown(): void {
    (this.ctx as unknown as { effect(fn: () => (() => void) | void, name?: string): unknown })
      .effect(() => () => {
        for (const pending of [...this.pending.values()]) {
          this.cleanup(pending);
          pending.reject(new UserQuestionError('im-qqbot user-questions answerer was disposed', 'ASK_ABORTED'));
        }
      }, 'im-qqbot.user-questions.teardown');
  }

  // ── ask：挂起 + 渲染 + 超时/abort ──

  private ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    const agent = request.agent;
    if (agent === undefined) {
      return Promise.reject(new UserQuestionError('qq user interaction requires an agent-owned session', 'ASK_MISSING_AGENT'));
    }
    const record = this.manager.findByAgent(agent);
    if (record === undefined) {
      return Promise.reject(new UserQuestionError('no QQ session for this agent', 'NO_QQ_SESSION'));
    }
    if (request.signal?.aborted) {
      return Promise.reject(new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED'));
    }

    return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
      const pending: PendingQuestion = {
        agentId: agent.id,
        record,
        questions: request.questions,
        answers: request.questions.map(() => undefined),
        resolve,
        reject,
        timer: setTimeout(() => {
          this.cleanup(pending);
          reject(new UserQuestionError('qq question timed out while waiting for the user', 'ASK_ABORTED'));
        }, this.config.questionTimeoutMs),
        signal: request.signal,
      };
      const onAbort = () => {
        this.cleanup(pending);
        reject(new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED'));
      };
      pending.onAbort = onAbort;
      request.signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(agent.id, pending);

      // 渲染并发送提问卡片；失败降级纯文字（promise 不挂起，等文字答案）
      void this.sendQuestions(record, request.questions).catch((err) => {
        this.logger.error(`im-qqbot: question card send failed: ${err instanceof Error ? err.message : String(err)}`);
        if (this.config.questionTextFallback) {
          void this.sendTextFallback(record, request.questions).catch((fallbackErr) => {
            this.logger.error(`im-qqbot: question text fallback failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`);
          });
        }
      });
    });
  }

  // ── 渲染 ──

  /** 每问题一张卡片；单选有选项 → 按钮行；多选/无选项 → 文字引导 */
  private async sendQuestions(record: SessionRecord, questions: AskUserQuestionItem[]): Promise<void> {
    for (const [qi, q] of questions.entries()) {
      const isMulti = q.multiSelect === true;
      const buttons = !isMulti && q.options !== undefined && q.options.length > 0
        ? q.options.map((opt, oi) => ({
          label: opt.label,
          data: this.encodeButton(record.agent.id, qi, oi),
        }))
        : [];
      const markdown = this.renderQuestion(q, isMulti);
      await this.bot.sendMarkdown(
        record.replyTarget,
        markdown,
        buttons.length > 0 ? { keyboard: buildKeyboard(buttons) } : undefined,
      );
    }
  }

  private renderQuestion(q: AskUserQuestionItem, isMulti: boolean): string {
    const lines: string[] = [];
    lines.push(q.header ? `**${q.header}**\n${q.question}` : `**${q.question}**`);
    if (q.detail) lines.push(q.detail);
    if (q.options !== undefined && q.options.length > 0) {
      lines.push(q.options.map((opt, i) => `${i + 1}. ${opt.label}`).join('\n'));
    }
    if (isMulti) {
      lines.push('（可多选：回复选项编号，多个用逗号分隔）');
    } else if (q.options !== undefined && q.options.length > 0) {
      lines.push('（点击下方按钮，或直接回复选项编号 / 文字）');
    } else {
      lines.push('（请直接回复文字）');
    }
    return lines.join('\n\n');
  }

  /** 卡片发送失败时的纯文字提问（仍挂 pending 等文字答案） */
  private async sendTextFallback(record: SessionRecord, questions: AskUserQuestionItem[]): Promise<void> {
    for (const q of questions) {
      const lines: string[] = [];
      lines.push(q.header ? `${q.header}：${q.question}` : q.question);
      if (q.detail) lines.push(q.detail);
      if (q.options !== undefined && q.options.length > 0) {
        lines.push(q.options.map((opt, i) => `${i + 1}. ${opt.label}`).join('\n'));
      }
      lines.push('（请直接回复选项编号或文字）');
      await this.bot.sendMarkdown(record.replyTarget, lines.filter(Boolean).join('\n'));
    }
  }

  // ── 答案入口（interaction / inbound 共用） ──

  /** 按钮点击：解析 `uq:<agentId>:<qi>:<oi>`，agentId 双保险校验后消费 */
  resolveButton(agentId: string, buttonData: string): boolean {
    const parsed = parseButtonData(buttonData);
    if (parsed === undefined || parsed.agentId !== agentId) return false;
    const pending = this.pending.get(agentId);
    if (pending === undefined) return false;

    const { qi, oi } = parsed;
    const q = pending.questions[qi];
    if (q === undefined) return false;
    if (pending.answers[qi] !== undefined) return false; // 该问题已答，忽略重复点击

    const option = q.options?.[oi];
    if (option === undefined) return false;

    pending.answers[qi] = { id: q.id, selected: [option.label] };
    return this.maybeResolve(pending);
  }

  /** 文字回答：回复的文本作为「第一个未答问题」的答案消费 */
  resolveText(agent: DshAgent, text: string): boolean {
    const pending = this.pending.get(agent.id);
    if (pending === undefined) return false;

    const idx = pending.answers.findIndex((a) => a === undefined);
    if (idx === -1) return false;

    const q = pending.questions[idx];
    if (q === undefined) return false;

    const trimmed = text.trim();
    if (trimmed.length === 0) return false;

    const answer = buildTextAnswer(q, trimmed);
    pending.answers[idx] = answer;
    return this.maybeResolve(pending);
  }

  /** 是否有挂起提问（inbound 分流用） */
  hasPending(agent: DshAgent): boolean {
    return this.pending.has(agent.id);
  }

  // ── 内部 ──

  private encodeButton(agentId: string, qi: number, oi: number): string {
    return `${BUTTON_PREFIX}${agentId}:${qi}:${oi}`;
  }

  /** 全部问题已答 → resolve；否则继续等待（本次输入已被消费） */
  private maybeResolve(pending: PendingQuestion): boolean {
    if (pending.answers.some((a) => a === undefined)) return true;
    this.cleanup(pending);
    pending.resolve({ answers: pending.answers as AskUserQuestionAnswerItem[] });
    return true;
  }

  private cleanup(pending: PendingQuestion): void {
    clearTimeout(pending.timer);
    if (pending.signal !== undefined && pending.onAbort !== undefined) {
      pending.signal.removeEventListener('abort', pending.onAbort);
    }
    if (this.pending.get(pending.agentId) === pending) {
      this.pending.delete(pending.agentId);
    }
  }
}

// ── 辅助 ──

/** 解析 `uq:<agentId>:<qi>:<oi>`；agentId 为 UUID（不含冒号） */
function parseButtonData(data: string): { agentId: string; qi: number; oi: number } | undefined {
  if (!data.startsWith(BUTTON_PREFIX)) return undefined;
  const parts = data.slice(BUTTON_PREFIX.length).split(':');
  if (parts.length !== 3) return undefined;
  const [agentId, qiStr, oiStr] = parts;
  if (agentId === undefined || agentId.length === 0) return undefined;
  const qi = Number(qiStr);
  const oi = Number(oiStr);
  if (!Number.isInteger(qi) || !Number.isInteger(oi) || qi < 0 || oi < 0) return undefined;
  return { agentId, qi, oi };
}

/** 按分隔符切分文本（支持逗号/顿号/分号/空白） */
function splitAnswer(text: string): string[] {
  return text.split(/[,，、;；\s]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * 把回复文本转成答案：
 * - 有选项：优先匹配选项 label / 编号（支持多个，逗号分隔），匹配进 selected，未匹配文本进 custom；
 * - 无选项：整段进 custom。
 */
function buildTextAnswer(q: AskUserQuestionItem, text: string): AskUserQuestionAnswerItem {
  const options = q.options ?? [];
  const selected: string[] = [];
  const unmatched: string[] = [];

  if (options.length > 0) {
    for (const token of splitAnswer(text)) {
      const byLabel = options.find((opt) => opt.label === token);
      const byNumber = /^\d+$/.test(token) ? options[Number(token) - 1] : undefined;
      const matched = byLabel ?? byNumber;
      if (matched !== undefined) {
        if (!selected.includes(matched.label)) selected.push(matched.label);
      } else {
        unmatched.push(token);
      }
    }
  } else {
    unmatched.push(text);
  }

  const custom = unmatched.join(', ');
  return custom.length > 0
    ? { id: q.id, selected, custom }
    : { id: q.id, selected };
}
