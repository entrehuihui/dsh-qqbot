/**
 * 入站消息投递策略 —— 决定一条用户消息是「排成新的一轮」还是「插进正在跑的那一轮」。
 *
 * dsh Agent 有两个投递入口：
 * - `followup`：作为独立一轮排队，当前轮跑完才轮到它；
 * - `steer`：投到最近的 step 边界，正在跑的那一轮在下一个 step 就读到（= 插话）。
 *
 * Web 端「繁忙时的发送行为」（`ui-conversation` 的 `busyEnter`）只作用于前端输入框，
 * 这里给 QQ 渠道一个等价的开关：`busySend: 'steer'`（默认，插话）/ `'queue'`（排队）。
 */
import type { BusySendBehavior } from '../config.js';
import type { Logger } from '../types.js';

/** 投递所需的最小 Agent 视图（`DshAgent` 结构兼容） */
export interface DeliverableAgent {
  readonly status: 'idle' | 'running' | 'blocked';
  followup(message: unknown): void;
  steer(message: unknown): void;
}

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
export function deliverUserMessage(
  agent: DeliverableAgent,
  message: unknown,
  busySend: BusySendBehavior,
  logger: Logger,
  label: string,
): void {
  // ★ 归档会话的 followup 会「静默成功」——注入不报错，但 DSH 的
  //   archived-session-gate 在 agent/pre-step 直接 reject，这一轮根本不跑，
  //   主人看到的就是「发了没反应」。正常路径已在 SessionManager.getOrCreate
  //   里识别归档并换新会话；这里留一条告警，方便排障时一眼认出是归档而不是别的毛病。
  if (agent.status === 'blocked') {
    logger.warn(`→ deliver to BLOCKED agent（可能被 archived-session-gate 拒了，查该会话是否已归档）: ${label}`);
  }

  if (agent.status === 'running' && busySend === 'steer') {
    agent.steer(message);
    logger.info(`→ steer sent (busy, 插话): ${label}`);
    return;
  }

  agent.followup(message);
  logger.info(`→ followup sent${agent.status === 'running' ? ' (busy → queue)' : ''}: ${label}`);
}
