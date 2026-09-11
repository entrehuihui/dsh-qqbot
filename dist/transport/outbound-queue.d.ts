/**
 * 出站消息队列 — 将多条发送串行化，并在消息之间保留最小间隔。
 *
 * 用于降低触发 QQ 平台消息频控的概率。
 */
export declare class OutboundQueue {
    private readonly minIntervalMs;
    private chain;
    private lastSendAt;
    constructor(minIntervalMs?: number);
    enqueue<T>(task: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=outbound-queue.d.ts.map