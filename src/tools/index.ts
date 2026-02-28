/**
 * tools/index.ts — Tool registry
 *
 * Tools are registered here and exposed to the OpenAI function-calling API.
 * Each tool declares its JSON Schema for parameters and an execute() handler.
 *
 * Adding a new tool in the future:
 *   1. Create src/tools/my-tool.ts exporting a ToolDefinition
 *   2. Import and push it into the `tools` array below
 */

import type OpenAI from "openai";
import { echoTool } from "./echo.js";
import { rememberTool } from "./remember.js";
import { recallTool } from "./recall.js";
import { webSearchTool } from "./web-search.js";
import { shellExecTool } from "./shell.js";
import {
    fileReadTool,
    fileWriteTool,
    fileAppendTool,
    fileDeleteTool,
    fileListTool,
    fileSearchTool,
} from "./files.js";
import { soulReadTool, soulUpdateTool } from "./soul.js";
import { buildMcpTools } from "./mcp-bridge.js";

export interface ToolDefinition {
    /** The OpenAI function specification */
    spec: OpenAI.Chat.Completions.ChatCompletionTool;
    /** Execute the tool and return a string result */
    execute(args: Record<string, unknown>): Promise<string>;
}

/** All registered tools — order doesn't matter */
export const tools: ToolDefinition[] = [
    echoTool,
    rememberTool,
    recallTool,
    webSearchTool,
    // ── Shell & File tools ────────────────────────────
    shellExecTool,
    fileReadTool,
    fileWriteTool,
    fileAppendTool,
    fileDeleteTool,
    fileListTool,
    fileSearchTool,
    // ── Self-improvement ──────────────────────────────
    soulReadTool,
    soulUpdateTool,
    // ── MCP tools appended dynamically
];

/**
 * (Re-)register all MCP tools in the tools array.
 * Call this after initMcp() or reloadMcp() completes.
 */
export function refreshMcpTools(): void {
    const nonMcp = tools.filter((t) => !t.spec.function.name.startsWith("mcp__"));
    tools.length = 0;
    tools.push(...nonMcp);

    const mcpTools = buildMcpTools();
    tools.push(...mcpTools);

    if (mcpTools.length > 0) {
        // Use console to avoid circular dependency with logger
        console.info(`[MCP] ${mcpTools.length} MCP tool(s) registered in agent tool registry`);
    }
}

/** Build the array to pass into OpenAI chat completions */
export function getOpenAITools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return tools.map((t) => t.spec);
}

/** Dispatch a function call by name */
export async function dispatchTool(
    name: string,
    rawArgs: string
): Promise<string> {
    const tool = tools.find((t) => t.spec.function.name === name);
    if (!tool) return `Error: unknown tool "${name}"`;

    let args: Record<string, unknown>;
    try {
        args = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch {
        return `Error: could not parse arguments as JSON: ${rawArgs}`;
    }

    try {
        return await tool.execute(args);
    } catch (err) {
        return `Error executing "${name}": ${String(err)}`;
    }
}
