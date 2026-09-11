import { createUserMessage } from '@deepseek-ai/dsh-llm';
/** 提问按钮 data 前缀（与 features/user-questions.ts 保持一致） */
const UQ_BUTTON_PREFIX = 'uq:';
export function registerInteractionHandler(bot, manager, logger, userQuestions) {
    bot.on('interaction', async (_ctx, event) => {
        try {
            const scope = event.group_openid || event.group_member_openid ? 'group' : 'c2c';
            const peerId = scope === 'group'
                ? (event.group_openid ?? event.group_member_openid ?? '')
                : (event.user_openid ?? '');
            const senderId = event.group_member_openid ?? event.user_openid ?? '';
            if (!peerId) {
                logger.warn('im-qqbot: interaction ignored, missing peer id');
                return;
            }
            const buttonData = event.data.resolved.button_data ?? event.data.resolved.button_id ?? '';
            const replyTarget = {
                scope,
                targetId: peerId,
                msgId: event.data.resolved.message_id,
            };
            // ── 提问按钮分流：uq: 前缀属于 userQuestions 提问卡片 ──
            if (userQuestions && buttonData.startsWith(UQ_BUTTON_PREFIX)) {
                const record = await manager.getOrCreate(scope, peerId, senderId, replyTarget);
                const consumed = userQuestions.resolveButton(record.agent.id, buttonData);
                await bot.acknowledgeInteraction(event.id, consumed ? 0 : 1);
                if (consumed) {
                    logger.info(`im-qqbot: interaction consumed as question answer: agent=${record.agent.id} data=${buttonData}`);
                }
                else {
                    // 挂起提问已 resolve / 过期 / 重复点击：ack 并丢弃，不打扰 agent
                    logger.debug(`im-qqbot: question button not pending, dropped: data=${buttonData}`);
                }
                return;
            }
            const text = `[Button clicked] ${buttonData}`;
            const content = [{ type: 'text', text }];
            const message = createUserMessage({
                content,
                source: { kind: 'user' },
            });
            const record = await manager.getOrCreate(scope, peerId, senderId, replyTarget);
            record.agent.followup(message);
            await bot.acknowledgeInteraction(event.id, 0);
            logger.info(`im-qqbot: interaction handled scope=${scope} data=${buttonData}`);
        }
        catch (err) {
            logger.error(`im-qqbot: interaction handler failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
}
//# sourceMappingURL=interaction.js.map