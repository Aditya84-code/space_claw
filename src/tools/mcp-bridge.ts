/**
 * tools/mcp-bridge.ts — Dynamic MCP tool bridge
 *
 * After MCP servers connect, call buildMcpTools() to generate ToolDefinition[]
 * from all discovered MCP tools. These are then registered in tools/index.ts
 * and dispatched through the same agentic loop as all other tools.
 *
 * Tool naming convention:  mcp__<serverName>__<toolName>
 * Example:                  mcp__zapier__gmail_find_email
 */

import type { ToolDefinition } from "./index.js";
import { getMcpTools, callMcpTool } from "../mcp/manager.js";

/**
 * Build ToolDefinition[] for all currently connected MCP tools.
 * Call this AFTER initMcp() completes.
 */
export function buildMcpTools(): ToolDefinition[] {
    const mcpTools = getMcpTools();

    return mcpTools.map((mcpTool) => ({
        spec: {
            type: "function" as const,
            function: {
                name: mcpTool.fullName,
                description: `[MCP:${mcpTool.serverName}] ${mcpTool.description}`,
                parameters: mcpTool.inputSchema as {
                    type: "object";
                    properties: Record<string, unknown>;
                    required?: string[];
                },
            },
        },
        execute: async (args: Record<string, unknown>): Promise<string> => {
            return callMcpTool(mcpTool.fullName, args);
        },
    }));
}
