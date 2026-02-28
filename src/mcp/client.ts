/**
 * mcp/client.ts — Thin wrapper around @modelcontextprotocol/sdk
 *
 * Supports:
 *   - stdio transport: spawns a child process (most common for local MCP servers)
 *   - SSE transport: connects to a remote HTTP endpoint
 *
 * Each McpClientWrapper manages a single server connection. The manager.ts
 * creates one per configured server.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "../logger.js";
import type { McpServerConfig, McpTool } from "./types.js";
import { resolveEnvVars } from "./installer.js";

export class McpClientWrapper {
    private client: Client | null = null;
    private _tools: McpTool[] = [];
    private _connected = false;
    private _error: string | undefined;

    constructor(private readonly cfg: McpServerConfig) { }

    get name(): string {
        return this.cfg.name;
    }

    get connected(): boolean {
        return this._connected;
    }

    get error(): string | undefined {
        return this._error;
    }

    get tools(): McpTool[] {
        return this._tools;
    }

    /** Connect to the MCP server and discover its tools */
    async connect(): Promise<void> {
        try {
            this.client = new Client(
                { name: "space-claw", version: "1.0.0" },
                { capabilities: {} }
            );

            const transport = this.buildTransport();
            const connectPromise = this.client.connect(transport as any);
            await Promise.race([
                connectPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error("Connection timeout")), 15000))
            ]);

            const discoverPromise = this.discoverTools();
            this._tools = await Promise.race([
                discoverPromise,
                new Promise<McpTool[]>((_, reject) => setTimeout(() => reject(new Error("Tool discovery timeout")), 15000))
            ]);

            this._connected = true;
            this._error = undefined;

            logger.info(`[MCP] Connected to "${this.cfg.name}"`, {
                transport: this.cfg.transport,
                tools: this._tools.length,
            });
        } catch (err) {
            this._connected = false;
            this._error = err instanceof Error ? err.message : String(err);
            logger.error(`[MCP] Failed to connect to "${this.cfg.name}"`, {
                error: this._error,
            });
        }
    }

    /** Disconnect cleanly */
    async disconnect(): Promise<void> {
        if (this.client) {
            try {
                await this.client.close();
            } catch {
                // Best-effort disconnect
            }
            this.client = null;
        }
        this._connected = false;
        this._tools = [];
    }

    /** Call a tool on this server */
    async callTool(
        toolName: string,
        args: Record<string, unknown>
    ): Promise<string> {
        if (!this.client || !this._connected) {
            return `Error: MCP server "${this.cfg.name}" is not connected`;
        }

        try {
            const result = await this.client.callTool({
                name: toolName,
                arguments: args,
            });

            // MCP tool results can be arrays of content blocks
            if (Array.isArray(result.content)) {
                const texts = result.content
                    .filter((c: { type: string }) => c.type === "text")
                    .map((c: { type: string; text?: string }) => c.text ?? "")
                    .join("\n");
                return texts || JSON.stringify(result.content);
            }

            return typeof result.content === "string"
                ? result.content
                : JSON.stringify(result);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return `Error calling MCP tool "${toolName}" on "${this.cfg.name}": ${msg}`;
        }
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private buildTransport() {
        const { transport, command, args, env, url } = this.cfg;

        if (transport === "stdio") {
            if (!command) {
                throw new Error(`Server "${this.cfg.name}" uses stdio but has no "command" configured`);
            }
            const resolvedEnv = resolveEnvVars(env);
            return new StdioClientTransport({
                command,
                args: args ?? [],
                env: { ...process.env, ...resolvedEnv } as Record<string, string>,
            });
        }

        if (transport === "sse") {
            if (!url) {
                throw new Error(`Server "${this.cfg.name}" uses sse but has no "url" configured`);
            }
            const resolvedEnv = resolveEnvVars(env);
            return new SSEClientTransport(new URL(url), {
                requestInit: {
                    headers: resolvedEnv
                }
            });
        }

        if (transport === "streamable_http") {
            if (!url) {
                throw new Error(`Server "${this.cfg.name}" uses streamable_http but has no "url" configured`);
            }
            const resolvedEnv = resolveEnvVars(env);
            return new StreamableHTTPClientTransport(new URL(url), {
                requestInit: {
                    headers: resolvedEnv
                }
            });
        }

        throw new Error(`Unknown transport "${transport as string}" for server "${this.cfg.name}"`);
    }

    private async discoverTools(): Promise<McpTool[]> {
        if (!this.client) return [];

        try {
            const response = await this.client.listTools();
            return (response.tools ?? []).map((t) => ({
                fullName: `mcp__${this.cfg.name}__${t.name}`,
                toolName: t.name,
                serverName: this.cfg.name,
                description: t.description ?? "",
                inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
            }));
        } catch (err) {
            logger.warn(`[MCP] Could not list tools for "${this.cfg.name}"`, {
                error: String(err),
            });
            return [];
        }
    }
}
