/**
 * providers/openai-provider.ts — OpenAI + OpenAI-compatible providers
 *
 * Covers: OpenAI, DeepSeek, Groq — all speak the OpenAI API format.
 * Groq and DeepSeek just use a different baseURL.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { LLMProvider, LLMResponse } from "./types.js";
import { logger } from "../logger.js";

function makeOpenAICompatible(
    id: string,
    name: string,
    defaultModel: string,
    apiKey: string,
    baseURL?: string
): LLMProvider {
    const client = new OpenAI({ apiKey, baseURL });

    return {
        id,
        name,
        defaultModel,

        async complete(messages, tools): Promise<LLMResponse> {
            logger.debug(`[${id}] complete()`, { model: defaultModel, msgs: messages.length });

            const baseParams = { model: defaultModel, messages } as const;
            const response = await client.chat.completions.create(
                tools.length > 0
                    ? { ...baseParams, tools, tool_choice: "auto" as const }
                    : baseParams
            );

            const choice = response.choices[0];
            if (!choice) throw new Error(`${name} returned no choices`);

            const msg = choice.message;

            if (msg.tool_calls && msg.tool_calls.length > 0) {
                return {
                    content: null,
                    toolCalls: msg.tool_calls.map((tc) => ({
                        id: tc.id,
                        name: tc.function.name,
                        arguments: tc.function.arguments,
                    })),
                    assistantMessage: msg as ChatCompletionMessageParam,
                };
            }

            return {
                content: msg.content ?? "(no response)",
                toolCalls: null,
                assistantMessage: msg as ChatCompletionMessageParam,
            };
        },
    };
}

/** Factory — called with live config values so keys are read after .env loads */
export function createOpenAIProvider(apiKey: string, model: string): LLMProvider {
    return makeOpenAICompatible("openai", "OpenAI", model, apiKey);
}

export function createDeepSeekProvider(apiKey: string, model: string): LLMProvider {
    return makeOpenAICompatible(
        "deepseek",
        "DeepSeek",
        model,
        apiKey,
        "https://api.deepseek.com"
    );
}

export function createGroqProvider(apiKey: string, model: string): LLMProvider {
    return makeOpenAICompatible(
        "groq",
        "Groq",
        model,
        apiKey,
        "https://api.groq.com/openai/v1"
    );
}
