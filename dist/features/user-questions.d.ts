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
import type { SessionManager } from '../session/index.js';
import type { DshAgent } from '../session/types.js';
import type { Logger } from '../types.js';
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
    intent?: {
        kind: string;
        approve?: string;
    };
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
/** 与 @deepseek-ai/dsh-user-questions 的 UserQuestionError 语义一致的本地错误（带 code） */
export declare class UserQuestionError extends Error {
    code: string;
    constructor(message: string, code: string);
}
export declare class UserQuestionsFeature {
    private readonly ctx;
    private readonly manager;
    private readonly bot;
    private readonly config;
    private readonly logger;
    /** agentId → PendingQuestion */
    private readonly pending;
    constructor(ctx: Context, manager: SessionManager, bot: QQBot, config: ImQQBotConfig, logger: Logger);
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
    private registerAnswerer;
    /** 插件卸载时，对全部挂起提问 reject ASK_ABORTED（同 web answerer 行为） */
    private teardown;
    private ask;
    /** 每问题一张卡片；单选有选项 → 按钮行；多选/无选项 → 文字引导 */
    private sendQuestions;
    private renderQuestion;
    /** 卡片发送失败时的纯文字提问（仍挂 pending 等文字答案） */
    private sendTextFallback;
    /** 按钮点击：解析 `uq:<agentId>:<qi>:<oi>`，agentId 双保险校验后消费 */
    resolveButton(agentId: string, buttonData: string): boolean;
    /** 文字回答：回复的文本作为「第一个未答问题」的答案消费 */
    resolveText(agent: DshAgent, text: string): boolean;
    /** 是否有挂起提问（inbound 分流用） */
    hasPending(agent: DshAgent): boolean;
    private encodeButton;
    /** 全部问题已答 → resolve；否则继续等待（本次输入已被消费） */
    private maybeResolve;
    private cleanup;
}
//# sourceMappingURL=user-questions.d.ts.map