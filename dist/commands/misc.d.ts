/**
 * 杂项命令
 *
 * - /bot-ping /bot-version：QQBot 插件特有（连通性测试、版本信息）
 * - /stop：中止当前生成（对应底层 agent cancel，通用能力）
 */
import type { CommandDeps, CategorizedCommand } from './types.js';
/** /bot-ping — 连通性测试 */
export declare function pingCommand(): CategorizedCommand;
/** /bot-version — 查看版本信息 */
export declare function versionCommand({ manager }: CommandDeps): CategorizedCommand;
/** /stop — 中止当前生成（隐藏） */
export declare function stopCommand({ manager }: CommandDeps): CategorizedCommand;
//# sourceMappingURL=misc.d.ts.map