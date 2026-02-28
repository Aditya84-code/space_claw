/**
 * providers/registry.ts — Provider registry + active model persistence
 *
 * Providers are registered here. The active provider+model is stored in
 * SQLite (core_memories table under the key "active_llm") so it survives restarts.
 *
 * Supported provider IDs:
 *   openai      gpt-4o, gpt-4o-mini, o3-mini, ...
 *   anthropic   claude-3-5-sonnet-20241022, claude-3-haiku-20240307, ...
 *   google      gemini-2.0-flash, gemini-1.5-pro, ...
 *   deepseek    deepseek-chat, deepseek-reasoner, ...
 *   groq        llama-3.3-70b-versatile, mixtral-8x7b-32768, ...
 */

import { config } from "../config.js";
import { logger } from "../logger.js";
import { setCoreMemory, getAllCoreMemories } from "../core-memory.js";
import type { LLMProvider } from "./types.js";
import { createOpenAIProvider, createGroqProvider } from "./openai-provider.js";
import { createAnthropicProvider } from "./anthropic-provider.js";
import { createGoogleProvider } from "./google-provider.js";

const ACTIVE_LLM_KEY = "active_llm";

/**
 * All known providers with their available models.
 * First model in the list is the default.
 */
export const PROVIDER_CATALOG: Record<string, { name: string; models: string[] }> = {
    openai: {
        name: "OpenAI",
        models: ["gpt-4o", "gpt-4.1", "gpt-4.1-mini", "gpt-5.1", "gpt-5.2", "gpt-5.1-mini"],
    },
    anthropic: {
        name: "Anthropic",
        models: ["claude-sonnet-4-5", "claude-sonnet-4"],
    },
    google: {
        name: "Google Gemini",
        models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"],
    },
    groq: {
        name: "Groq",
        models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    },
};

/** Build a provider instance from an id + model string */
function buildProvider(providerId: string, model: string): LLMProvider {
    switch (providerId) {
        case "openai":
            return createOpenAIProvider(config.OPENAI_API_KEY, model);
        case "anthropic":
            if (!config.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
            return createAnthropicProvider(config.ANTHROPIC_API_KEY, model);
        case "google":
            if (!config.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY is not set");
            return createGoogleProvider(config.GOOGLE_API_KEY, model);
        case "groq":
            if (!config.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");
            return createGroqProvider(config.GROQ_API_KEY, model);
        default:
            throw new Error(`Unknown provider: "${providerId}"`);
    }
}

// ── Active provider singleton ─────────────────────────────────────────────────

function loadActiveSpec(): { providerId: string; model: string } {
    const coreMemories = getAllCoreMemories();
    const entry = coreMemories.find((m) => m.key === ACTIVE_LLM_KEY);
    if (entry) {
        const [providerId, ...rest] = entry.value.split(":");
        const model = rest.join(":");
        if (providerId && model) return { providerId, model };
    }
    // Default to OpenAI with configured model
    return { providerId: "openai", model: config.OPENAI_MODEL };
}

let _provider: LLMProvider | null = null;
let _activeSpec = loadActiveSpec();

/** Get the current active provider (lazy-initialised) */
export function getActiveProvider(): LLMProvider {
    if (!_provider) {
        _provider = buildProvider(_activeSpec.providerId, _activeSpec.model);
        logger.info("LLM provider initialised", {
            provider: _activeSpec.providerId,
            model: _activeSpec.model,
        });
    }
    return _provider;
}

/** Returns a display string like "OpenAI · gpt-4o" */
export function getActiveProviderLabel(): string {
    const catalog = PROVIDER_CATALOG[_activeSpec.providerId];
    const providerName = catalog?.name ?? _activeSpec.providerId;
    return `${providerName} · ${_activeSpec.model}`;
}

/**
 * Switch to a new provider+model. Persists the choice to SQLite.
 * Returns an error string if the provider/model is unknown or not configured.
 */
export function switchProvider(providerId: string, model: string): string | null {
    const catalog = PROVIDER_CATALOG[providerId];
    if (!catalog) {
        return `Unknown provider "${providerId}". Available: ${Object.keys(PROVIDER_CATALOG).join(", ")}`;
    }

    // Build eagerly to check if the API key is available
    try {
        const newProvider = buildProvider(providerId, model);
        _provider = newProvider;
        _activeSpec = { providerId, model };
        setCoreMemory(ACTIVE_LLM_KEY, "Active LLM", `${providerId}:${model}`);
        logger.info("LLM provider switched", { providerId, model });
        return null; // success
    } catch (err) {
        return String(err);
    }
}
