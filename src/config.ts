/**
 * config.ts — Environment validation using Zod
 * Validated on startup. The process exits immediately if anything is missing.
 * Secrets live in .env only — never in code or logs.
 */

import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
    /** Telegram bot token from @BotFather */
    TELEGRAM_BOT_TOKEN: z.string().min(20, "TELEGRAM_BOT_TOKEN is required"),

    /** Your personal Telegram numeric user ID — whitelist */
    ALLOWED_USER_ID: z
        .string()
        .regex(/^\d+$/, "ALLOWED_USER_ID must be a numeric Telegram user ID")
        .transform(Number),

    /** OpenAI API key */
    OPENAI_API_KEY: z.string().startsWith("sk-", "OPENAI_API_KEY must start with sk-"),

    /** Model name */
    OPENAI_MODEL: z.string().default("gpt-4o"),

    /** Maximum agentic tool-call iterations per turn */
    AGENT_MAX_ITERATIONS: z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .default("10"),

    /** Path to the SQLite memory database file */
    MEMORY_DB_PATH: z.string().default("./data/memory.db"),

    /** Log level */
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    /** Tavily API key for the web_search tool (https://app.tavily.com) */
    TAVILY_API_KEY: z.string().default(""),

    /** Anthropic API key (for Claude models) */
    ANTHROPIC_API_KEY: z.string().default(""),

    /** Google AI API key (for Gemini models) */
    GOOGLE_API_KEY: z.string().default(""),

    /** Groq API key */
    GROQ_API_KEY: z.string().default(""),

    /** Supabase project URL (from Project Settings → API) */
    SUPABASE_URL: z.string().url().optional().or(z.literal("")).default(""),

    /** Supabase service-role secret key (from Project Settings → API) */
    SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),

    /** Enable semantic (vector) memory via Supabase pgvector */
    SEMANTIC_MEMORY_ENABLED: z
        .string()
        .transform((v) => v === "true" || v === "1")
        .default("true"),

    /** Enable text-to-speech voice replies via ElevenLabs */
    TTS_ENABLED: z
        .string()
        .transform((v) => v === "true" || v === "1")
        .default("false"),

    /** ElevenLabs API key — required when TTS_ENABLED=true */
    ELEVENLABS_API_KEY: z.string().default(""),

    /** ElevenLabs voice ID (find yours at elevenlabs.io/voices) */
    ELEVENLABS_VOICE_ID: z.string().default("21m00Tcm4TlvDq8ikWAM"), // Rachel

    /** Transcribe incoming Telegram voice messages via Whisper */
    VOICE_TRANSCRIPTION_ENABLED: z
        .string()
        .transform((v) => v === "true" || v === "1")
        .default("false"),

    // ── Shell command tool ────────────────────────────────────────────────────

    /** Comma-separated list of executable names the shell_exec tool may run */
    SHELL_ALLOWED_COMMANDS: z
        .string()
        .default("node,npm,git,ls,dir,cat,echo,pwd,python,python3,pip,pip3"),

    /** Max milliseconds before a shell command is force-killed */
    SHELL_TIMEOUT_MS: z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .default("30000"),

    /** Informational flag — reserved for future confirmation UX */
    SHELL_REQUIRE_CONFIRM: z
        .string()
        .transform((v) => v === "true" || v === "1")
        .default("false"),

    // ── File operation tools ──────────────────────────────────────────────────

    /** Comma-separated path prefixes that file tools are allowed to access */
    FILE_ALLOWED_PATHS: z.string().default("./data,./skills"),

    /** Maximum file size (bytes) for read/write operations (default 1 MB) */
    FILE_MAX_SIZE_BYTES: z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .default("1048576"),

    // ── MCP Tool Bridge ───────────────────────────────────────────────────────

    /** Enable the MCP client bridge */
    MCP_ENABLED: z
        .string()
        .transform((v) => v === "true" || v === "1")
        .default("true"),

    /** Path to mcp-servers.json (relative to project root) */
    MCP_SERVERS_CONFIG: z.string().default("./mcp-servers.json"),
});

function parseEnv() {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
        console.error("❌ Invalid environment configuration:\n");
        for (const issue of result.error.issues) {
            console.error(`  • ${issue.path.join(".")}: ${issue.message}`);
        }
        console.error("\nCopy .env.example to .env and fill in your values.\n");
        process.exit(1);
    }
    return result.data;
}

export const config = parseEnv();
export type Config = typeof config;
