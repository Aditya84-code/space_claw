/**
 * bot.ts — GrammY Telegram bot setup
 *
 * Security guarantees:
 *   1. WHITELIST: All incoming updates are checked against ALLOWED_USER_ID.
 *      Any message from an unknown user is silently dropped.
 *   2. LONG-POLLING only — no web server, no exposed port.
 *   3. Conversation history is persisted in SQLite (memory.ts) so it survives
 *      bot restarts. Notes saved via the remember tool also persist.
 */

import { Bot, InputFile, type Context } from "grammy";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { runAgentTurn } from "./agent.js";
import { textToSpeech, synthesize } from "./tts.js";
import { transcribeVoice } from "./transcribe.js";
import { startSetup, handleSetupReply } from "./setup.js";
import { getActiveProviderLabel, switchProvider, PROVIDER_CATALOG } from "./providers/registry.js";
import { getLoadedSkills } from "./skills-loader.js";
import { getMcpStatus, reloadMcp, hasMcpServers } from "./mcp/manager.js";
import { refreshMcpTools } from "./tools/index.js";
import {
    loadHistory,
    saveHistory,
    deleteHistory,
    getAllNotes,
} from "./memory.js";

/** Silently drop any update from an unauthorized user */
function isAuthorized(ctx: Context): boolean {
    const userId = ctx.from?.id;
    return userId === config.ALLOWED_USER_ID;
}

/** Escape special MarkdownV2 characters */
function escapeMd(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

export function createBot(): Bot {
    const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

    // ── Whitelist middleware ─────────────────────────────────────────────────
    bot.use(async (ctx, next) => {
        if (!isAuthorized(ctx)) {
            logger.warn("Ignoring message from unauthorized user", {
                userId: ctx.from?.id,
            });
            return; // silent drop
        }
        await next();
    });

    // ── /start ───────────────────────────────────────────────────────────────
    bot.command("start", async (ctx) => {
        await ctx.reply(
            "👋 Hey\\! I'm *Space Claw*, your personal AI agent\\.\n\n" +
            "I have *persistent memory*, *multi-LLM support*, and a *skills system*\\.\n\n" +
            "Commands: /clear · /memory · /status · /model · /skills\n\n" +
            "_Running Level 3 — Skills & Multi-LLM_",
            { parse_mode: "MarkdownV2" }
        );
    });

    // ── /clear ───────────────────────────────────────────────────────────────
    bot.command("clear", async (ctx) => {
        const chatId = ctx.chat.id;
        deleteHistory(chatId);
        await ctx.reply(
            "🧹 Conversation history cleared\\. Starting fresh\\!\n" +
            "_Saved notes \\(/memory\\) are preserved\\._",
            { parse_mode: "MarkdownV2" }
        );
        logger.info("Conversation cleared", { chatId });
    });

    // ── /memory ──────────────────────────────────────────────────────────────
    bot.command("memory", async (ctx) => {
        const notes = getAllNotes();
        if (notes.length === 0) {
            await ctx.reply(
                "🗒 No saved notes yet\\.\n" +
                "Ask me to _remember_ something and I'll store it here\\!",
                { parse_mode: "MarkdownV2" }
            );
            return;
        }

        const lines = notes.map(
            (n, i) => `${i + 1}\\. *${escapeMd(n.title)}*\n${escapeMd(n.body)}`
        );
        await ctx.reply(
            `🗒 *Saved Notes* \\(${notes.length}\\)\n\n${lines.join("\n\n")}`,
            { parse_mode: "MarkdownV2" }
        );
    });

    // ── /setup ────────────────────────────────────────────────────────
    bot.command("setup", async (ctx) => {
        await startSetup(ctx);
    });

    // ── /skills ──────────────────────────────────────────────────────────────
    bot.command("skills", async (ctx) => {
        const skills = getLoadedSkills();
        if (skills.length === 0) {
            await ctx.reply(
                "🎯 No skills loaded. Drop `.md` files into the `/skills` directory and restart the bot.",
                { parse_mode: "Markdown" }
            );
            return;
        }

        const lines = skills.map(
            (s, i) => `${i + 1}. *${s.name}*\n_${s.description}_`
        );
        await ctx.reply(
            `🎯 *Loaded Skills* (${skills.length})\n\n${lines.join("\n\n")}\n\n` +
            `_Drop a_ \`.md\` _file into /skills and restart to add more._`,
            { parse_mode: "Markdown" }
        );
    });

    // ── /model ────────────────────────────────────────────────────────
    bot.command("model", async (ctx) => {
        const arg = ctx.match?.trim() ?? "";

        // /model  → show current + catalog
        if (!arg) {
            const catalog = Object.entries(PROVIDER_CATALOG)
                .map(([id, p]) => `*${id}* — ${p.models.join(", ")}`)
                .join("\n");
            await ctx.reply(
                `🤖 *Active model:* ${getActiveProviderLabel()}\n\n` +
                `*Available providers & models:*\n${catalog}\n\n` +
                `_Usage: /model <provider> <model>_\n` +
                `_Example: /model anthropic claude-3-5-sonnet-20241022_`,
                { parse_mode: "Markdown" }
            );
            return;
        }

        // /model <provider> <model>  → switch
        const parts = arg.split(/\s+/);
        const providerId = parts[0]?.toLowerCase() ?? "";
        const model = (parts.slice(1).join(" ") || PROVIDER_CATALOG[providerId]?.models[0]) ?? "";

        if (!model) {
            await ctx.reply(`❌ Please specify a model. Example: /model ${providerId} ${PROVIDER_CATALOG[providerId]?.models[0] ?? "<model>"}`);
            return;
        }

        const err = switchProvider(providerId, model);
        if (err) {
            await ctx.reply(`❌ ${err}`);
        } else {
            await ctx.reply(`✅ Switched to *${getActiveProviderLabel()}*`, { parse_mode: "Markdown" });
        }
    });

    // ── /mcp ─────────────────────────────────────────────────────────────────
    bot.command("mcp", async (ctx) => {
        const arg = ctx.match?.trim() ?? "";

        if (arg === "reload") {
            await ctx.reply("🔄 Reloading MCP servers…");
            await reloadMcp();
            refreshMcpTools();
            await ctx.reply("✅ MCP servers reloaded. Check /mcp for status.");
            return;
        }

        if (!hasMcpServers()) {
            await ctx.reply(
                "🔌 *MCP Bridge*\n\n" +
                "No servers configured.\n" +
                "Add servers to `mcp-servers.json` and type `/mcp reload`.",
                { parse_mode: "Markdown" }
            );
            return;
        }

        const status = getMcpStatus();
        let msg = "🔌 *MCP Servers*\n\n";

        for (const s of status) {
            const icon = s.connected ? "✅" : "❌";
            msg += `${icon} *${s.name}* (${s.transport})\n`;
            if (s.connected) {
                msg += `   └ Tools: ${s.toolCount}\n`;
            } else if (s.error) {
                // Escape markdown characters in error string
                const errSafe = s.error.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
                msg += `   └ Error: _${errSafe}_\n`;
            }
            msg += "\n";
        }

        msg += "_Usage: /mcp reload_";
        await ctx.reply(msg, { parse_mode: "Markdown" });
    });

    // ── /status ──────────────────────────────────────────────────────────────
    bot.command("status", async (ctx) => {
        const chatId = ctx.chat.id;
        const history = loadHistory(chatId);
        const notes = getAllNotes();
        const skills = getLoadedSkills();
        await ctx.reply(
            "🤖 *Space Claw Status*\n\n" +
            "Level: 3 — Skills & Multi-LLM\n" +
            `Model: \`${getActiveProviderLabel()}\`\n` +
            `History turns: ${history.length}\n` +
            `Saved notes: ${notes.length}\n` +
            `Loaded skills: ${skills.length}\n` +
            `Max tool iterations: ${config.AGENT_MAX_ITERATIONS}`,
            { parse_mode: "Markdown" }
        );
    });

    // ── Text messages ────────────────────────────────────────────────────────
    bot.on("message:text", async (ctx) => {
        // If /setup is in progress, consume this message for the flow first
        const consumed = await handleSetupReply(ctx);
        if (consumed) return;
        const chatId = ctx.chat.id;
        const userText = ctx.message.text;

        logger.info("Incoming message", { chatId, length: userText.length });

        // Show typing indicator
        await ctx.replyWithChatAction("typing");

        try {
            const history = loadHistory(chatId);
            const { reply, updatedHistory } = await runAgentTurn(history, userText);

            // Persist updated history to SQLite
            saveHistory(chatId, updatedHistory);

            // Send text reply first
            await ctx.reply(reply, { parse_mode: "Markdown" });

            // Optionally send a voice message using TTS
            if (config.TTS_ENABLED) {
                await ctx.replyWithChatAction("record_voice");
                // Strip markdown formatting for cleaner audio
                const plainText = reply
                    .replace(/\*\*?(.*?)\*\*?/g, "$1")  // bold
                    .replace(/__(.*?)__/g, "$1")          // underline
                    .replace(/~~(.*?)~~/g, "$1")          // strikethrough
                    .replace(/`{1,3}[^`]*`{1,3}/g, "")   // inline code / code blocks
                    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → label
                    .trim();

                const audioBuffer = await textToSpeech(plainText);
                if (audioBuffer) {
                    await ctx.replyWithVoice(
                        new InputFile(audioBuffer, "reply.mp3")
                    );
                    logger.info("Voice message sent", { bytes: audioBuffer.length });
                }
            }
        } catch (err) {
            logger.error("Agent error", { err: String(err) });
            await ctx.reply(
                "❌ Something went wrong on my end. Check the logs and try again."
            );
        }
    });

    // ── Voice messages ───────────────────────────────────────────────────────
    bot.on("message:voice", async (ctx) => {
        if (!config.VOICE_TRANSCRIPTION_ENABLED) {
            await ctx.reply(
                "🔇 Voice transcription is disabled. Set `VOICE_TRANSCRIPTION_ENABLED=true` to enable it."
            );
            return;
        }

        const chatId = ctx.chat.id;
        const voice = ctx.message.voice;
        logger.info("Incoming voice message", {
            chatId,
            duration: voice.duration,
            fileSize: voice.file_size,
        });

        await ctx.replyWithChatAction("typing");

        try {
            // 1. Resolve the Telegram file URL
            const fileInfo = await ctx.api.getFile(voice.file_id);
            if (!fileInfo.file_path) {
                await ctx.reply("❌ Could not retrieve voice file from Telegram.");
                return;
            }
            const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

            // 2. Transcribe via Whisper
            const transcript = await transcribeVoice(fileUrl);
            if (!transcript) {
                await ctx.reply("❌ Transcription failed — could not understand the audio.");
                return;
            }

            // Echo transcript so the owner can see what was understood
            await ctx.reply(`🎙️ _Heard:_ "${transcript}"`, { parse_mode: "Markdown" });

            // 3. Run the agent on the transcribed text
            await ctx.replyWithChatAction("typing");
            const history = loadHistory(chatId);
            const { reply, updatedHistory } = await runAgentTurn(history, transcript);
            saveHistory(chatId, updatedHistory);

            // 4. Send text reply
            await ctx.reply(reply, { parse_mode: "Markdown" });

            // 5. Always reply with a voice message for voice conversations
            await ctx.replyWithChatAction("record_voice");
            const plainText = reply
                .replace(/\*\*?(.*?)\*\*?/g, "$1")       // bold
                .replace(/__(.*?)__/g, "$1")               // underline
                .replace(/~~(.*?)~~/g, "$1")               // strikethrough
                .replace(/`{1,3}[^`]*`{1,3}/g, "")        // code
                .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // links → label
                .trim();

            // synthesize() bypasses TTS_ENABLED — voice-in always gets voice-out
            const audioBuffer = await synthesize(plainText);
            if (audioBuffer) {
                await ctx.replyWithVoice(new InputFile(audioBuffer, "reply.mp3"));
                logger.info("Voice reply sent", { bytes: audioBuffer.length });
            } else {
                logger.warn("ElevenLabs voice reply skipped — check ELEVENLABS_API_KEY");
            }
        } catch (err) {
            logger.error("Voice message handler error", { err: String(err) });
            await ctx.reply("❌ Something went wrong processing your voice message.");
        }
    });

    // ── Error handler ────────────────────────────────────────────────────────
    bot.catch((err) => {
        logger.error("Unhandled bot error", { err: String(err) });
    });

    return bot;
}
