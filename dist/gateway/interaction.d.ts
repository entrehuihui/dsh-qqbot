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
import type { QQBot } from '@tencent-connect/qqbot-nodejs';
import type { SessionManager } from '../session/index.js';
import type { UserQuestionsFeature } from '../features/user-questions.js';
import type { Logger } from '../types.js';
import type { ImQQBotConfig } from '../config.js';
export declare function registerInteractionHandler(bot: QQBot, manager: SessionManager, logger: Logger, userQuestions?: UserQuestionsFeature, config?: ImQQBotConfig): void;
//# sourceMappingURL=interaction.d.ts.map