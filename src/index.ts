/**
 * index.ts — Space Claw entry point
 *
 * Validates config, creates the bot, starts long-polling.
 * Handles graceful shutdown on SIGINT / SIGTERM.
 */

import { createBot } from "./bot.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { loadSkills } from "./skills-loader.js";
import { initMcp, shutdownMcp } from "./mcp/manager.js";
import { refreshMcpTools } from "./tools/index.js";

async function main() {
    logger.info("🚀 Space Claw starting up…", {
        model: config.OPENAI_MODEL,
        maxIterations: config.AGENT_MAX_ITERATIONS,
    });

    // Load skills from /skills directory before the bot starts
    loadSkills();

    // Initialise MCP servers before the bot starts
    await initMcp();
    refreshMcpTools();

    const bot = createBot();

    // Graceful shutdown
    process.once("SIGINT", () => {
        logger.info("Received SIGINT, shutting down…");
        void shutdownMcp();
        void bot.stop();
    });
    process.once("SIGTERM", () => {
        logger.info("Received SIGTERM, shutting down…");
        void shutdownMcp();
        void bot.stop();
    });

    // Start long-polling (no web server, no exposed port)
    await bot.start({
        onStart(botInfo) {
            logger.info(`✅ Bot is online as @${botInfo.username}`);
            logger.info(
                `🔒 Only responding to Telegram user ID: ${config.ALLOWED_USER_ID}`
            );
        },
    });
}

main().catch((err) => {
    console.error("Fatal error during startup:", err);
    process.exit(1);
});
