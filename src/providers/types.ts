/**
 * providers/types.ts — Unified LLM provider interface
 *
 * All providers implement LLMProvider. The agent loop only speaks this interface.
 * Internally, messages are stored in OpenAI format (canonical). Providers
 * translate to/from their native format on each call.
 */

import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

export interface ToolCall {
    id: string;
    name: string;
    arguments: string; // raw JSON string
}

export interface LLMResponse {
    /** Text content of the reply (null when tool calls are present) */
    content: string | null;
    /** Tool calls requested by the model (null when text reply is present) */
    toolCalls: ToolCall[] | null;
    /**
     * The assistant message in OpenAI format, ready to push onto history.
     * Each provider builds this correctly for its own response shape.
     */
    assistantMessage: ChatCompletionMessageParam;
}

export interface LLMProvider {
    /** Stable identifier used in /model command: "openai", "anthropic", "google", etc. */
    readonly id: string;
    /** Human-friendly display name */
    readonly name: string;
    /** Default model string for this provider */
    readonly defaultModel: string;

    /**
     * Run one completion. Messages are in OpenAI format (canonical).
     * Tools are in OpenAI function-calling format.
     */
    complete(
        messages: ChatCompletionMessageParam[],
        tools: ChatCompletionTool[]
    ): Promise<LLMResponse>;
}
