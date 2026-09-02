/**
 * QQ 交互事件处理 — 按钮点击回调。
 *
 * 当用户点击卡片按钮时，SDK 触发 `interaction` 事件。
 * 这里把按钮点击转换成一条 user 消息，交给当前 QQ 会话对应的 Agent 处理。
 *
 * 提问分流（Stage 02）：按钮 data 以 `uq:` 开头时，优先判断是否属于挂起的
 * userQuestions 提问（agentId 双保险校验）；命中则 ack 并作为答案消费，
 * 不再 followup 给 Agent。未命中的普通卡片按钮（qq_send_card 等）走原逻辑。
 */
import type { QQBot, InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { SessionManager } from '../session/index.js';
import type { UserQuestionsFeature } from '../features/user-questions.js';
import type { Logger } from '../types.js';

/** 提问按钮 data 前缀（与 features/user-questions.ts 保持一致） */
const UQ_BUTTON_PREFIX = 'uq:';

export function registerInteractionHandler(
  bot: QQBot,
  manager: SessionManager,
  logger: Logger,
  userQuestions?: UserQuestionsFeature,
): void {
  bot.on('interaction', async (_ctx, event: InteractionEvent) => {
    try {
      const scope: 'c2c' | 'group' =
        event.group_openid || event.group_member_openid ? 'group' : 'c2c';
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
        } else {
          // 挂起提问已 resolve / 过期 / 重复点击：ack 并丢弃，不打扰 agent
          logger.debug(`im-qqbot: question button not pending, dropped: data=${buttonData}`);
        }
        return;
      }

      const text = `[Button clicked] ${buttonData}`;
      const content: ContentBlock[] = [{ type: 'text' as const, text }];

      const message = createUserMessage({
        content,
        source: { kind: 'user' as const },
      });

      const record = await manager.getOrCreate(scope, peerId, senderId, replyTarget);
      record.agent.followup(message);

      await bot.acknowledgeInteraction(event.id, 0);
      logger.info(`im-qqbot: interaction handled scope=${scope} data=${buttonData}`);
    } catch (err) {
      logger.error(`im-qqbot: interaction handler failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
