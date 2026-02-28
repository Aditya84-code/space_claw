/**
 * tools/echo.ts — A demonstration tool.
 *
 * This is intentionally trivial — its purpose is to prove that the agentic
 * loop can call a tool, receive a result, and incorporate it into the reply.
 * Replace / remove this when you have real tools.
 */

import type { ToolDefinition } from "./index.js";

export const echoTool: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "echo",
            description:
                "Echoes back whatever text you give it. Use this to test that the tool-calling loop is working.",
            parameters: {
                type: "object",
                properties: {
                    text: {
                        type: "string",
                        description: "The text to echo back.",
                    },
                },
                required: ["text"],
                additionalProperties: false,
            },
        },
    },

    async execute(args) {
        const text = String(args["text"] ?? "");
        return `Echo: ${text}`;
    },
};
