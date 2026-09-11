/**
 * 出站消息队列 — 将多条发送串行化，并在消息之间保留最小间隔。
 *
 * 用于降低触发 QQ 平台消息频控的概率。
 */
export class OutboundQueue {
    minIntervalMs;
    chain = Promise.resolve();
    lastSendAt = 0;
    constructor(minIntervalMs = 300) {
        this.minIntervalMs = minIntervalMs;
    }
    enqueue(task) {
        const run = this.chain.then(async () => {
            const elapsed = Date.now() - this.lastSendAt;
            const wait = this.minIntervalMs - elapsed;
            if (wait > 0) {
                await new Promise(resolve => setTimeout(resolve, wait));
            }
            try {
                return await task();
            }
            finally {
                this.lastSendAt = Date.now();
            }
        });
        this.chain = run.then(() => { }, () => { });
        return run;
    }
}
//# sourceMappingURL=outbound-queue.js.map