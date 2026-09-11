/**
 * QQ 媒体发送工具 — 注入到 dsh tools 注册表，供 Agent 直接发送图片/视频/语音/文件。
 *
 * 通过 dsh 的 `tools` 服务注册，Agent 在对话中可调用 `qq_send_media`。
 * 当前会话由执行工具时的 agent 反查 SessionManager 得到，不需要用户额外指定目标。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { QQBot } from '@tencent-connect/qqbot-nodejs';
import type { SessionManager } from '../session/index.js';
import type { Logger } from '../types.js';
/**
 * 注册 QQ 媒体发送工具。
 *
 * 如果宿主没有提供 `tools` 服务，则静默跳过，不影响插件原有功能。
 */
export declare function registerQQMediaTools(ctx: Context, manager: SessionManager, bot: QQBot, logger: Logger): void;
//# sourceMappingURL=qq-media.d.ts.map