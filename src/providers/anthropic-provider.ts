/**
 * providers/anthropic-provider.ts — Anthropic Claude
 *
 * Converts OpenAI-format messages ↔ Anthropic format.
 * Tool calls are translated between OpenAI function-calling and Anthropic tool_use.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { LLMProvider, LLMResponse } from "./types.js";
import { logger } from "../logger.js";

/** Convert OpenAI messages to Anthropic format */
function toAnthropicMessages(messages: ChatCompletionMessageParam[]): {
    system: string;
    msgs: Anthropic.MessageParam[];
} {
    let system = "";
    const msgs: Anthropic.MessageParam[] = [];

    for (const m of messages) {
        if (m.role === "system") {
            system = typeof m.content === "string" ? m.content : "";
            continue;
        }

        if (m.role === "user") {
            const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            msgs.push({ role: "user", content: text });
            continue;
        }

        if (m.role === "assistant") {
            // Build content array — may contain text and/or tool_use blocks
            const contentBlocks: Anthropic.ContentBlockParam[] = [];

            if (m.content && typeof m.content === "string" && m.content.length > 0) {
                contentBlocks.push({ type: "text", text: m.content });
            }

            if ("tool_calls" in m && Array.isArray(m.tool_calls)) {
                for (const tc of m.tool_calls) {
                    const toolUse: Anthropic.ToolUseBlockParam = {
                        type: "tool_use",
                        id: tc.id,
                        name: tc.function.name,
                        input: JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>,
                    };
                    contentBlocks.push(toolUse);
                }
            }

            if (contentBlocks.length > 0) {
                msgs.push({ role: "assistant", content: contentBlocks });
            }
            continue;
        }

        if (m.role === "tool") {
            // Anthropic wants tool results as user messages with tool_result blocks
            const toolResultBlock: Anthropic.ToolResultBlockParam = {
                type: "tool_result",
                tool_use_id: m.tool_call_id ?? "",
                content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            };

            const last = msgs[msgs.length - 1];
            if (last && last.role === "user" && Array.isArray(last.content)) {
                (last.content as Anthropic.ToolResultBlockParam[]).push(toolResultBlock);
            } else {
                msgs.push({ role: "user", content: [toolResultBlock] });
            }
        }
    }

    return { system, msgs };
}

/** Convert OpenAI tools to Anthropic tool specs */
function toAnthropicTools(tools: ChatCompletionTool[]): Anthropic.Tool[] {
    return tools.map((t) => ({
        name: t.function.name,
        description: t.function.description ?? "",
        input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
    }));
}

export function createAnthropicProvider(apiKey: string, model: string): LLMProvider {
    const client = new Anthropic({ apiKey });

    return {
        id: "anthropic",
        name: "Anthropic",
        defaultModel: model,

        async complete(messages, tools): Promise<LLMResponse> {
            logger.debug("[anthropic] complete()", { model, msgs: messages.length });

            const { system, msgs } = toAnthropicMessages(messages);
            const anthropicTools = toAnthropicTools(tools);

            const params: Anthropic.MessageCreateParamsNonStreaming = {
                model,
                max_tokens: 4096,
                system,
                messages: msgs,
                ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
            };

            const response = await client.messages.create(params);

            // Check for tool_use blocks
            const toolUseBlocks = response.content.filter(
                (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
            );

            if (toolUseBlocks.length > 0) {
                const textContent = response.content
                    .filter((b): b is Anthropic.TextBlock => b.type === "text")
                    .map((b) => b.text)
                    .join("");

                const openAIToolCalls = toolUseBlocks.map((b) => ({
                    id: b.id,
                    type: "function" as const,
                    function: {
                        name: b.name,
                        arguments: JSON.stringify(b.input),
                    },
                }));

                const assistantMessage: ChatCompletionMessageParam = {
                    role: "assistant",
                    content: textContent || null,
                };
                // Assign tool_calls via unknown cast — TS union narrowing prevents direct assignment
                (assistantMessage as unknown as Record<string, unknown>)["tool_calls"] = openAIToolCalls;

                return {
                    content: null,
                    toolCalls: toolUseBlocks.map((b) => ({
                        id: b.id,
                        name: b.name,
                        arguments: JSON.stringify(b.input),
                    })),
                    assistantMessage,
                };
            }

            // Plain text response
            const text = response.content
                .filter((b): b is Anthropic.TextBlock => b.type === "text")
                .map((b) => b.text)
                .join("");

            return {
                content: text || "(no response)",
                toolCalls: null,
                assistantMessage: { role: "assistant", content: text || "(no response)" },
            };
        },
    };
}
