/**
 * mcp/types.ts — Shared types for the MCP Tool Bridge
 */

/** How to connect to an MCP server */
export type McpTransport = "stdio" | "sse" | "streamable_http";

/** Per-server configuration read from mcp-servers.json */
export interface McpServerConfig {
    /** Unique name — used to prefix tool names: mcp__<name>__<tool> */
    name: string;
    /** Transport protocol to use */
    transport: McpTransport;
    /** [stdio] Executable to spawn (e.g. "node", "npx") */
    command?: string;
    /** [stdio] Arguments to the command */
    args?: string[];
    /** [stdio] Additional environment variables (supports ${VAR} substitution from process.env) */
    env?: Record<string, string>;
    /** [sse] HTTP URL of the MCP SSE endpoint */
    url?: string;
    /** Human-readable description shown in /mcp and system prompt */
    description?: string;
    /** Optional shell command to run to install this server (e.g. "npm install -g @zapier/mcp") */
    installCommand?: string;
    /** Whether to skip this server at runtime (default: false) */
    disabled?: boolean;
}

/** Root shape of mcp-servers.json */
export interface McpServersFile {
    servers: McpServerConfig[];
}

/** A single tool advertised by an MCP server */
export interface McpTool {
    /** Fully-qualified name: mcp__<server>__<toolName> */
    fullName: string;
    /** Raw tool name as reported by the server */
    toolName: string;
    /** Server this tool belongs to */
    serverName: string;
    /** Human-readable description */
    description: string;
    /** JSON Schema for the input parameters */
    inputSchema: Record<string, unknown>;
}

/** Runtime status of a single MCP server connection */
export interface McpServerStatus {
    name: string;
    transport: McpTransport;
    connected: boolean;
    toolCount: number;
    error?: string;
}
