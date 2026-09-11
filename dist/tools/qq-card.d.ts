/**
 * QQ 卡片消息工具 — 尽可能自由的卡片发送。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type QQBot } from '@tencent-connect/qqbot-nodejs';
import type { SessionManager } from '../session/index.js';
import type { Logger } from '../types.js';
interface CardButtonArg {
    label?: string;
    data?: string;
    style?: number;
}
/** 构建 QQ 官方 inline keyboard（供 qq-card 工具与 user-questions 提问卡片复用） */
export declare function buildKeyboard(buttons: CardButtonArg[]): {
    content: {
        rows: {
            buttons: {
                id: string;
                render_data: {
                    label: string;
                    visited_label: string;
                    style: number;
                };
                action: {
                    type: number;
                    permission: {
                        type: number;
                    };
                    data: string;
                };
            }[];
        }[];
    };
} | undefined;
export declare function registerQQCardTools(ctx: Context, manager: SessionManager, bot: QQBot, logger: Logger): void;
export {};
//# sourceMappingURL=qq-card.d.ts.map