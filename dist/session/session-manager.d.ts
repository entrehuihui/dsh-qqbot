import type { Context } from '@deepseek-ai/cordis';
import type { ChatScope, Logger, ReplyTarget } from '../types.js';
import type { ImQQBotConfig } from '../config.js';
import type { ModelRoute, ModelEntry } from '../model/types.js';
import type { DshAgent, DshAgentRegistry, SessionRecord, SessionStatus, TokenUsageStats, CompactOutcome } from './types.js';
export declare class SessionManager {
    private readonly ctx;
    private readonly agents;
    private readonly config;
    private readonly logger;
    private sessions;
    /**
     * `/new` 之后被「脱离」的会话记录。
     *
     * 上游直接 `handle.dispose()`，宿主随即发出 `session/disposed`，
     * api-session-controller 把它转成 `api-session/removed` 推给前端，
     * 前端从侧栏列表里把这行 filter 掉 —— 用户看到的就是「会话被清掉了」，
     * 实际上磁盘上一个字节都没少。
     *
     * 这里改为保留记录、不 dispose：旧会话继续活在宿主里，侧栏（未分组）
     * 照常可见、可点开继续看/聊。数量受 config.keepDetachedSessions 限制，
     * 超出时按 FIFO 真正释放最早的，避免无限增长。
     */
    private detachedSessions;
    private readonly evictor;
    private readonly modelResolver;
    constructor(ctx: Context, agents: DshAgentRegistry, config: ImQQBotConfig, logger: Logger);
    /**
     * 动态获取 sessions 服务（fork 能力，可选）
     */
    private getSessionsService;
    getEffectiveModel(scope: ChatScope, peerId: string): ModelRoute | undefined;
    /**
     * 切换模型（fork + 重建，对齐 dsh-TUI 的 switchModel）
     */
    setModelOverride(scope: ChatScope, peerId: string, route: ModelRoute): Promise<void>;
    clearModelOverride(scope: ChatScope, peerId: string): void;
    listAvailableModels(): Promise<ModelEntry[]>;
    listProviders(): string[];
    getSessionRecord(scope: ChatScope, peerId: string): SessionRecord | undefined;
    getStatus(scope: ChatScope, peerId: string): SessionStatus;
    getTokenUsage(scope: ChatScope, peerId: string): TokenUsageStats;
    exportMarkdown(scope: ChatScope, peerId: string): string;
    private countMessages;
    private sessionKey;
    private deriveSessionId;
    private currentSessionId;
    /**
     * 这个会话是不是被归档（archived）了？
     *
     * ★★ 归档会话是「假活」：`agents.get()` 拿得到、`agents.resume()` 也照样能从
     * 磁盘恢复出来，而且**不报错**。但 DSH 的 `archived-session-gate` 会在
     * `agent/pre-step` 直接 reject —— 它自己的注释写得很清楚：
     * 「an archived Session ... must not run a model step until it is restored」
     * 「the loop ends as 'blocked' without a request」。
     *
     * 于是本插件以为拿到了活会话，`followup` 注入成功、日志还老实写「已投递」，
     * agent 却永远不跑：不发模型请求、不回话。用户那边看到的就是
     * 「QQ 发消息没反应，也没有新会话」——只有 `/new` 换掉 sessionId 才恢复。
     *
     * 所以用到某个会话之前必须自己查一眼归档集合，把它当「这个会话不可用」。
     * 同样的坑 dsh-cluster 插件踩过（见其 `isArchivedSession`），处理方式保持一致。
     */
    private isArchivedSession;
    private composePreset;
    /** 获取或恢复或创建会话（get → resume → create） */
    getOrCreate(scope: ChatScope, peerId: string, senderId: string, replyTarget: ReplyTarget): Promise<SessionRecord>;
    findBySessionId(sessionId: string): SessionRecord | undefined;
    findByAgent(agent: DshAgent): SessionRecord | undefined;
    remove(scope: ChatScope, peerId: string): Promise<void>;
    /**
     * 原地压缩当前会话历史（保留 sessionId，用摘要替换旧历史）。
     *
     * 需通过 agentPresets.serviceFor(agent, 'compaction') 解析；未挂载时优雅降级。
     * 这是「压缩上下文」的语义，区别于 remove() 的「换新会话」。
     */
    compact(scope: ChatScope, peerId: string): Promise<CompactOutcome>;
    disposeAll(): Promise<void>;
    get size(): number;
}
//# sourceMappingURL=session-manager.d.ts.map