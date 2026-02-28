/**
 * providers/google-provider.ts — Google Gemini
 *
 * Converts OpenAI-format messages ↔ Gemini format.
 * Tool declarations converted from OpenAI function-calling specs.
 */

import {
    GoogleGenerativeAI,
    type Content,
    type FunctionCall,
    type SchemaType,
} from "@google/generative-ai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { LLMProvider, LLMResponse } from "./types.js";
import { logger } from "../logger.js";

/** Convert OpenAI messages → Gemini history array + the last user prompt */
function toGeminiHistory(messages: ChatCompletionMessageParam[]): {
    system: string;
    history: Content[];
    lastUserMessage: string;
} {
    let system = "";
    const history: Content[] = [];
    let lastUserMessage = "";

    const nonSystem = messages.filter((m) => m.role !== "system");

    for (const m of messages) {
        if (m.role === "system") {
            system = typeof m.content === "string" ? m.content : "";
        }
    }

    for (let i = 0; i < nonSystem.length; i++) {
        const m = nonSystem[i];
        if (!m) continue;

        if (m.role === "user") {
            const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
            // Last user message goes as the prompt; everything before it goes in history
            if (i === nonSystem.length - 1) {
                lastUserMessage = text;
            } else {
                history.push({ role: "user", parts: [{ text }] });
            }
            continue;
        }

        if (m.role === "assistant") {
            const text = typeof m.content === "string" ? m.content : "";
            const tcs = "tool_calls" in m && Array.isArray(m.tool_calls) ? m.tool_calls : [];
            if (tcs.length > 0) {
                history.push({
                    role: "model",
                    parts: tcs.map((tc) => ({
                        functionCall: {
                            name: tc.function.name,
                            args: JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>,
                        } satisfies FunctionCall,
                    })),
                });
            } else if (text) {
                history.push({ role: "model", parts: [{ text }] });
            }
            continue;
        }

        if (m.role === "tool") {
            history.push({
                role: "function",
                parts: [{
                    functionResponse: {
                        name: "tool",
                        response: { content: m.content ?? "" },
                    },
                }],
            });
        }
    }

    return { system, history, lastUserMessage };
}

/**
 * Gemini's API is stricter than OpenAI's JSON Schema subset.
 * It rejects: additionalProperties, $schema, $defs, examples, default, etc.
 * Recursively strip all unsupported keys before sending to Gemini.
 */
const GEMINI_UNSUPPORTED_KEYS = new Set([
    "additionalProperties", "$schema", "$defs", "$ref",
    "examples", "default", "title", "definitions",
]);

function stripGeminiUnsupported(obj: unknown): unknown {
    if (Array.isArray(obj)) return obj.map(stripGeminiUnsupported);
    if (obj !== null && typeof obj === "object") {
        const cleaned: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            if (!GEMINI_UNSUPPORTED_KEYS.has(k)) {
                cleaned[k] = stripGeminiUnsupported(v);
            }
        }
        return cleaned;
    }
    return obj;
}

/**
 * After stripping, also ensure `required[]` only lists properties that exist
 * in `properties` — Gemini rejects any required entry with no matching property.
 * Also remove the raw "type" from the cleaned params so our "OBJECT" wins.
 */
function sanitizeGeminiParams(raw: Record<string, unknown>): Record<string, unknown> {
    const stripped = stripGeminiUnsupported(raw) as Record<string, unknown>;

    // Remove "type" from stripped so our explicit "OBJECT" is used (avoids lowercase "object")
    delete stripped["type"];

    const props = stripped["properties"] as Record<string, unknown> | undefined;
    const required = stripped["required"];

    if (Array.isArray(required) && props) {
        stripped["required"] = (required as string[]).filter((k) => k in props);
        if ((stripped["required"] as string[]).length === 0) {
            delete stripped["required"];
        }
    } else if (required) {
        // No properties defined — drop required entirely
        delete stripped["required"];
    }

    return stripped;
}

export function createGoogleProvider(apiKey: string, model: string): LLMProvider {
    const genAI = new GoogleGenerativeAI(apiKey);

    return {
        id: "google",
        name: "Google Gemini",
        defaultModel: model,

        async complete(messages, tools): Promise<LLMResponse> {
            logger.debug("[google] complete()", { model, msgs: messages.length });

            const { system, history, lastUserMessage } = toGeminiHistory(messages);

            // Build Gemini tool declarations with sanitized schemas
            const geminiToolDecls = tools.map((t) => {
                const raw = (t.function.parameters ?? {}) as Record<string, unknown>;
                const clean = sanitizeGeminiParams(raw);
                return {
                    name: t.function.name,
                    description: t.function.description ?? "",
                    parameters: { type: "OBJECT" as SchemaType, ...clean },
                };
            });

            const modelParams = {
                model,
                systemInstruction: system,
                ...(geminiToolDecls.length > 0
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ? { tools: [{ functionDeclarations: geminiToolDecls as any }] }
                    : {}),
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const geminiModel = genAI.getGenerativeModel(modelParams as any);
            const chat = geminiModel.startChat({ history });
            const result = await chat.sendMessage(lastUserMessage);
            const response = result.response;

            // Check for function calls
            const fnCalls = response.functionCalls();
            if (fnCalls && fnCalls.length > 0) {
                let callIdx = 0;
                const toolCalls = fnCalls.map((fc) => ({
                    id: `gemini-${callIdx++}`,
                    name: fc.name,
                    arguments: JSON.stringify(fc.args),
                }));

                const assistantMessage: ChatCompletionMessageParam = {
                    role: "assistant",
                    content: null,
                };
                (assistantMessage as unknown as Record<string, unknown>)["tool_calls"] = toolCalls.map((tc) => ({
                    id: tc.id,
                    type: "function",
                    function: { name: tc.name, arguments: tc.arguments },
                }));

                return { content: null, toolCalls, assistantMessage };
            }

            const text = response.text();
            return {
                content: text || "(no response)",
                toolCalls: null,
                assistantMessage: { role: "assistant", content: text || "(no response)" },
            };
        },
    };
}
