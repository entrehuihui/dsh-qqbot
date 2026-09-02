/**
 * QQ 卡片消息工具 — 尽可能自由的卡片发送。
 */
import type { Context } from '@deepseek-ai/cordis';
import { MediaFileType, MsgType, type QQBot } from '@tencent-connect/qqbot-nodejs';
import type { SessionManager } from '../session/index.js';
import type { DshAgent } from '../session/types.js';
import type { Logger } from '../types.js';

interface ToolsRegistryLike {
  register(tool: unknown): void;
}

interface ToolExecContext {
  agent?: DshAgent;
  signal?: AbortSignal;
}

interface CardButtonArg {
  label?: string;
  data?: string;
  style?: number;
}

interface MarkdownParam {
  key?: string;
  values?: string[];
}

interface ArkKV {
  key?: string;
  value?: string;
  obj?: unknown[];
}

interface QQSendCardArgs {
  mode?: 'markdown' | 'markdown_template' | 'ark' | 'embed' | 'media';
  text?: string;
  image?: string;
  image_url?: string;
  buttons?: CardButtonArg[];
  custom_template_id?: string;
  params?: MarkdownParam[];
  template_id?: number;
  kv?: ArkKV[];
  embed?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

function toJsonSchema(spec: Record<string, { type: string; required?: boolean; description?: string; items?: unknown }>) {
  const properties: Record<string, { type: string; description?: string; items?: unknown }> = {};
  const required: string[] = [];
  for (const [key, meta] of Object.entries(spec)) {
    const prop: { type: string; description?: string; items?: unknown } = { type: meta.type };
    if (meta.description) prop.description = meta.description;
    if (meta.items) prop.items = meta.items;
    properties[key] = prop;
    if (meta.required) required.push(key);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/** 构建 QQ 官方 inline keyboard（供 qq-card 工具与 user-questions 提问卡片复用） */
export function buildKeyboard(buttons: CardButtonArg[]) {
  if (buttons.length === 0) return undefined;
  return {
    content: {
      rows: [
        {
          buttons: buttons.map((b, index) => ({
            id: `card-btn-${index}`,
            render_data: {
              label: b.label!,
              visited_label: b.label!,
              style: b.style ?? 1,
            },
            action: { type: 2, permission: { type: 2 }, data: b.data! },
          })),
        },
      ],
    },
  };
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function resolveMode(args: QQSendCardArgs): 'markdown' | 'markdown_template' | 'ark' | 'embed' | 'media' {
  if (args.custom_template_id) return 'markdown_template';
  if (args.template_id) return 'ark';
  if (args.embed) return 'embed';
  if (args.mode === 'media') return 'media';
  return 'markdown';
}

function getToolsRegistry(ctx: Context): ToolsRegistryLike | undefined {
  try {
    const service = ctx.get('tools') as ToolsRegistryLike | undefined;
    if (service) return service;
  } catch {
    // ignore
  }
  return (ctx as unknown as { tools?: ToolsRegistryLike }).tools;
}

export function registerQQCardTools(
  ctx: Context,
  manager: SessionManager,
  bot: QQBot,
  logger: Logger,
): void {
  const tools = getToolsRegistry(ctx);
  if (!tools) {
    logger.debug('im-qqbot: tools service unavailable, skip QQ card tool registration');
    return;
  }

  tools.register({
    name: 'qq_send_card',
    description: [
      'Send a highly customizable card-style message to the current QQ conversation.',
      'Supported modes: markdown, markdown_template, ark, embed, media.',
      '- markdown: text + optional image URL + optional buttons',
      '- media: local image or media + text + optional buttons',
      '- markdown_template: use custom_template_id + params',
      '- ark: use template_id + kv',
      '- embed: use embed object',
      'All modes support optional buttons and extra passthrough fields.',
    ].join('\n'),
    parameters: toJsonSchema({
      mode: { type: 'string', required: false, description: 'Card mode: markdown, markdown_template, ark, embed, media' },
      text: { type: 'string', required: false, description: 'Markdown text / caption' },
      image: { type: 'string', required: false, description: 'Local image path or HTTPS image URL' },
      image_url: { type: 'string', required: false, description: 'HTTPS image URL (deprecated alias)' },
      buttons: {
        type: 'array', required: false, description: 'Optional buttons',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Button label' },
            data: { type: 'string', description: 'Button callback data' },
            style: { type: 'number', description: 'Button style' },
          },
          required: ['label', 'data'],
        },
      },
      custom_template_id: { type: 'string', required: false, description: 'Markdown custom template ID' },
      params: { type: 'array', required: false, description: 'Markdown template params', items: { type: 'object' } },
      template_id: { type: 'number', required: false, description: 'Ark template ID' },
      kv: { type: 'array', required: false, description: 'Ark template kv', items: { type: 'object' } },
      embed: { type: 'object', required: false, description: 'Embed card object' },
      extra: { type: 'object', required: false, description: 'Extra passthrough fields' },
    }),
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      render: (_args: unknown, value: { text?: string }) => [{ type: 'text', text: value.text ?? '' }],
    },
    async execute(args: QQSendCardArgs, exec: ToolExecContext) {
      const agent = exec?.agent;
      if (!agent) {
        return { text: '❌ 无法获取当前 Agent 上下文' };
      }

      const record = manager.findByAgent(agent);
      if (!record) {
        return { text: '❌ 找不到当前 QQ 会话，无法发送卡片' };
      }

      const mode = args.mode ?? resolveMode(args);
      const text = args.text?.trim();
      const image = args.image?.trim() ?? args.image_url?.trim();
      const buttons = Array.isArray(args.buttons) ? args.buttons.filter(b => b?.label && b?.data) : [];
      const keyboard = buildKeyboard(buttons);

      try {
        const target = record.replyTarget;

        switch (mode) {
          case 'markdown_template': {
            await bot.send({
              target,
              msgType: MsgType.MARKDOWN,
              markdown: {
                content: text ?? '',
                custom_template_id: args.custom_template_id ?? '',
                params: (args.params ?? []).map(p => ({
                  key: p.key ?? '',
                  values: p.values ?? [],
                })),
              },
              ...(keyboard ? { keyboard } : {}),
              ...(args.extra ? { extra: args.extra } : {}),
            });
            break;
          }

          case 'ark': {
            await bot.send({
              target,
              msgType: MsgType.ARK,
              ark: {
                template_id: args.template_id ?? 0,
                kv: (args.kv ?? []).map(k => ({
                  key: k.key ?? '',
                  ...(k.value !== undefined ? { value: k.value } : {}),
                  ...(k.obj !== undefined ? { obj: k.obj } : {}),
                })),
              },
              ...(keyboard ? { keyboard } : {}),
              ...(args.extra ? { extra: args.extra } : {}),
            });
            break;
          }

          case 'embed': {
            await bot.send({
              target,
              msgType: MsgType.EMBED,
              embed: args.embed ?? {},
              ...(keyboard ? { keyboard } : {}),
              ...(args.extra ? { extra: args.extra } : {}),
            });
            break;
          }

          case 'media': {
            if (!image) {
              return { text: '❌ media 模式需要提供 image' };
            }
            const upload = await bot.uploadMedia({
              target,
              fileType: MediaFileType.IMAGE,
              ...(isHttpUrl(image) ? { url: image } : { localPath: image }),
            });
            await bot.send({
              target,
              msgType: MsgType.MEDIA,
              media: { file_info: upload.file_info },
              ...(text ? { content: text } : {}),
              ...(keyboard ? { keyboard } : {}),
              ...(args.extra ? { extra: args.extra } : {}),
            });
            break;
          }

          case 'markdown':
          default: {
            if (image && !isHttpUrl(image)) {
              const upload = await bot.uploadMedia({
                target,
                fileType: MediaFileType.IMAGE,
                localPath: image,
              });
              await bot.send({
                target,
                msgType: MsgType.MEDIA,
                media: { file_info: upload.file_info },
                ...(text ? { content: text } : {}),
                ...(keyboard ? { keyboard } : {}),
                ...(args.extra ? { extra: args.extra } : {}),
              });
            } else {
              const content = image
                ? `![#400px #300px](${image})

${text ?? ''}`
                : (text ?? '');
              await bot.sendMarkdown(
                target,
                content,
                keyboard ? { keyboard } : undefined,
              );
            }
            break;
          }
        }

        return { text: '✅ 卡片已发送' };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`im-qqbot: send card failed: ${message}`);
        return { text: `❌ 发送卡片失败: ${message}` };
      }
    },
  });

  logger.info('im-qqbot: QQ card tool registered (qq_send_card)');
}
