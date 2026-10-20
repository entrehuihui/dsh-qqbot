/**
 * 把一条已构建好的 UserMessage 交给 Agent。
 *
 * - Agent 空闲：一律 `followup`，正常开一轮；
 * - Agent 正在跑：按 `busySend` 决定 —— `steer` 插话（下一 step 边界读到），`queue` 排队（旧行为）。
 *
 * 只在 `running` 时插话，是为了对齐 dsh 前端的 `resolveSubmitMode`：空闲态下 steering 槽位没有额外收益。
 *
 * @param agent - 目标 Agent
 * @param message - 已构建的用户消息
 * @param busySend - 配置的繁忙投递方式
 * @param logger - 插件 logger
 * @param label - 日志标识，调用方拼上会话键（如 `key=c2c:xxx`）
 */
export function deliverUserMessage(agent, message, busySend, logger, label) {
    if (agent.status === 'running' && busySend === 'steer') {
        agent.steer(message);
        logger.info(`→ steer sent (busy, 插话): ${label}`);
        return;
    }
    agent.followup(message);
    logger.info(`→ followup sent${agent.status === 'running' ? ' (busy → queue)' : ''}: ${label}`);
}
//# sourceMappingURL=deliver.js.map