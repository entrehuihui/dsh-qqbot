import { audioFileToSilkBase64 } from '@tencent-connect/qqbot-nodejs/protocol';
function toJsonSchema(spec) {
    const properties = {};
    const required = [];
    for (const [key, meta] of Object.entries(spec)) {
        const prop = { type: meta.type };
        if (meta.enum)
            prop.enum = meta.enum;
        if (meta.description)
            prop.description = meta.description;
        properties[key] = prop;
        if (meta.required)
            required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
}
/**
 * 注册 QQ 媒体发送工具。
 *
 * 如果宿主没有提供 `tools` 服务，则静默跳过，不影响插件原有功能。
 */
export function registerQQMediaTools(ctx, manager, bot, logger) {
    const tools = getToolsRegistry(ctx);
    if (!tools) {
        logger.debug('im-qqbot: tools service unavailable, skip QQ media tool registration');
        return;
    }
    tools.register({
        name: 'qq_send_media',
        description: [
            'Send an image, video, voice, or file to the current QQ conversation.',
            'The media source can be a local file path (relative to the agent cwd) or an https URL.',
            'For voice messages, local audio files such as mp3/flac are automatically transcoded to a QQ-compatible voice format when possible.',
            'Use this when the user asks the bot to send a picture, video, audio, document, or other file.',
        ].join('\n'),
        parameters: toJsonSchema({
            media_type: {
                type: 'string',
                enum: ['image', 'video', 'voice', 'file'],
                required: true,
                description: 'Type of media to send: image, video, voice, or file',
            },
            source: {
                type: 'string',
                required: true,
                description: 'Local file path or https URL of the media to send',
            },
            caption: {
                type: 'string',
                required: false,
                description: 'Optional text caption shown with the media (not supported for voice)',
            },
            file_name: {
                type: 'string',
                required: false,
                description: 'Optional file name for file uploads; defaults to the source file name',
            },
        }),
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    text: { type: 'string' },
                },
                required: ['text'],
            },
            render: (_args, value) => [{ type: 'text', text: value.text ?? '' }],
        },
        async execute(args, exec) {
            const mediaType = args.media_type;
            const source = args.source?.trim();
            const caption = args.caption?.trim();
            const fileName = args.file_name?.trim();
            if (!mediaType || !['image', 'video', 'voice', 'file'].includes(mediaType)) {
                return { text: '❌ 请指定 media_type: image / video / voice / file' };
            }
            if (!source) {
                return { text: '❌ 请提供 source（本地路径或 https URL）' };
            }
            const agent = exec?.agent;
            if (!agent) {
                return { text: '❌ 无法获取当前 Agent 上下文' };
            }
            const record = manager.findByAgent(agent);
            if (!record) {
                return { text: '❌ 找不到当前 QQ 会话，无法发送媒体' };
            }
            const mediaSource = /^https?:\/\//i.test(source)
                ? { url: source }
                : { localPath: source };
            try {
                const target = record.replyTarget;
                switch (mediaType) {
                    case 'image':
                        await bot.sendImage(target, mediaSource, caption ? { content: caption } : undefined);
                        break;
                    case 'video':
                        await bot.sendVideo(target, mediaSource, caption ? { content: caption } : undefined);
                        break;
                    case 'voice': {
                        let voiceSource = mediaSource;
                        if (mediaSource.localPath) {
                            const silkBase64 = await audioFileToSilkBase64(mediaSource.localPath, undefined, {
                                log: (msg) => logger.info(`[audio-convert] ${msg}`),
                                warn: (msg) => logger.warn(`[audio-convert] ${msg}`),
                                error: (msg) => logger.error(`[audio-convert] ${msg}`),
                            });
                            if (silkBase64) {
                                voiceSource = { buffer: Buffer.from(silkBase64, 'base64') };
                            }
                            else {
                                return { text: '❌ 无法将音频转码为 QQ 语音格式，请安装 ffmpeg 或改用 media_type=file 发送' };
                            }
                        }
                        await bot.sendVoice(target, voiceSource);
                        break;
                    }
                    case 'file':
                        await bot.sendFile(target, mediaSource, {
                            ...(fileName ? { fileName } : {}),
                            ...(caption ? { content: caption } : {}),
                        });
                        break;
                }
                logger.info(`im-qqbot: media sent type=${mediaType} source=${source}`);
                return { text: `✅ 已发送${mediaType}到当前会话` };
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logger.error(`im-qqbot: send media failed type=${mediaType}: ${message}`);
                return { text: `❌ 发送${mediaType}失败: ${message}` };
            }
        },
    });
    logger.info('im-qqbot: QQ media tool registered (qq_send_media)');
}
function getToolsRegistry(ctx) {
    try {
        const service = ctx.get('tools');
        if (service)
            return service;
    }
    catch {
        // ignore
    }
    return ctx.tools;
}
//# sourceMappingURL=qq-media.js.map