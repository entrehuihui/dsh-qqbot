/** 插件版本号（从 package.json 读取，供 help/version 等展示真实版本） */
export declare const PLUGIN_VERSION: string;
/**
 * 获取插件版本号
 */
export declare function getPluginVersion(): string;
/**
 * 构造 User-Agent 头
 *
 * 格式: dsh-qqbot/{version} (Node/{nodeVersion}; {platform})
 */
export declare function buildUserAgent(): string;
/**
 * 从插件安装路径推导 profile 目录（node_modules 的父目录）
 *
 * 逐级向上查找名为 node_modules 的目录并返回其父目录。
 * 用 basename/dirname 而非字符串分隔符匹配，兼容 Windows（\）与 pnpm 嵌套结构。
 *
 * @param baseDir - 起始目录，缺省为插件根（可注入便于测试）
 */
export declare function getProfileDir(baseDir?: string): string | null;
/**
 * 解析环境变量占位配置
 */
export declare function resolveEnv(configValue: string, envKey: string): string;
/**
 * 格式化相对时间
 */
export declare function formatRelativeTime(ts?: number): string;
//# sourceMappingURL=utils.d.ts.map