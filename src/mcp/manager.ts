/**
 * mcp/manager.ts — Singleton that manages all MCP server connections
 *
 * Usage:
 *   await initMcp();           // reads mcp-servers.json, installs + connects
 *   getMcpTools();             // returns all discovered tools across all servers
 *   callMcpTool(name, args);   // routes to the correct server
 *   getMcpStatus();            // for the /mcp bot command
 *   shutdownMcp();             // clean disconnect (called on SIGINT/SIGTERM)
 *   reloadMcp();               // re-read config and reconnect
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { logger } from "../logger.js";
import { config } from "../config.js";
import type { McpTool, McpServerStatus, McpServersFile, McpServerConfig } from "./types.js";
import { McpClientWrapper } from "./client.js";
import { ensureServerInstalled } from "./installer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Active connections — keyed by server name
const clients = new Map<string, McpClientWrapper>();

// Track original configs for status reporting
const serverConfigs = new Map<string, McpServerConfig>();

// ── Config loading ────────────────────────────────────────────────────────────

function loadServersConfig(): McpServerConfig[] {
    const configPath = resolve(join(__dirname, "..", ".."), config.MCP_SERVERS_CONFIG);

    if (!existsSync(configPath)) {
        logger.info(`[MCP] Config file not found at ${configPath} — no MCP servers will be loaded`);
        return [];
    }

    try {
        const raw = readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw) as McpServersFile;
        const servers = (parsed.servers ?? []).filter((s) => !s.disabled);
        logger.info(`[MCP] Loaded ${servers.length} server(s) from ${configPath}`);
        return servers;
    } catch (err) {
        logger.error("[MCP] Failed to parse mcp-servers.json", { error: String(err) });
        return [];
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise all configured MCP servers.
 * Reads mcp-servers.json, installs each server if needed, and connects.
 * Safe to call multiple times — disconnects existing connections first.
 */
export async function initMcp(): Promise<void> {
    if (!config.MCP_ENABLED) {
        logger.info("[MCP] MCP is disabled (MCP_ENABLED=false)");
        return;
    }

    // Disconnect any existing connections
    await shutdownMcp();

    const cfgs = loadServersConfig();
    if (cfgs.length === 0) return;

    logger.info(`[MCP] Initialising ${cfgs.length} server(s)…`);

    await Promise.all(
        cfgs.map(async (cfg) => {
            serverConfigs.set(cfg.name, cfg);

            // Step 1: Install if needed
            const installed = await ensureServerInstalled(cfg);
            if (!installed) {
                // Still register the wrapper so /mcp can report the error
                const wrapper = new McpClientWrapper(cfg);
                clients.set(cfg.name, wrapper);
                return;
            }

            // Step 2: Connect
            const wrapper = new McpClientWrapper(cfg);
            await wrapper.connect();
            clients.set(cfg.name, wrapper);
        })
    );

    const connected = [...clients.values()].filter((c) => c.connected).length;
    const total = clients.size;
    logger.info(`[MCP] Ready — ${connected}/${total} server(s) connected`);
}

/** Reload config and reconnect all servers (for /mcp reload command) */
export async function reloadMcp(): Promise<void> {
    logger.info("[MCP] Reloading MCP servers…");
    await initMcp();
}

/** Disconnect all MCP servers cleanly */
export async function shutdownMcp(): Promise<void> {
    if (clients.size === 0) return;
    logger.info("[MCP] Shutting down MCP connections…");
    await Promise.all([...clients.values()].map((c) => c.disconnect()));
    clients.clear();
    serverConfigs.clear();
}

/** Get all discovered tools across all connected servers */
export function getMcpTools(): McpTool[] {
    const all: McpTool[] = [];
    for (const client of clients.values()) {
        if (client.connected) {
            all.push(...client.tools);
        }
    }
    return all;
}

/** Route a tool call to the correct server */
export async function callMcpTool(
    fullName: string,
    args: Record<string, unknown>
): Promise<string> {
    // fullName format: mcp__<serverName>__<toolName>
    const match = fullName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
    if (!match) {
        return `Error: invalid MCP tool name "${fullName}". Expected format: mcp__<server>__<tool>`;
    }

    // Use a simpler split strategy: prefix is always "mcp", server is index 1, rest is tool
    const parts = fullName.split("__");
    if (parts.length < 3 || parts[0] !== "mcp") {
        return `Error: invalid MCP tool name "${fullName}"`;
    }
    const serverName = parts[1] ?? "";
    const toolName = parts.slice(2).join("__"); // handle tool names containing __

    const client = clients.get(serverName);
    if (!client) {
        return `Error: MCP server "${serverName}" is not configured. Available: ${[...clients.keys()].join(", ") || "none"}`;
    }
    if (!client.connected) {
        return `Error: MCP server "${serverName}" is not connected. Reason: ${client.error ?? "unknown"}. Try /mcp reload.`;
    }

    return client.callTool(toolName, args);
}

/** Get status of all configured servers (for /mcp bot command) */
export function getMcpStatus(): McpServerStatus[] {
    return [...clients.values()].map((c) => {
        const cfg = serverConfigs.get(c.name);
        const status: McpServerStatus = {
            name: c.name,
            transport: cfg?.transport ?? "stdio",
            connected: c.connected,
            toolCount: c.tools.length,
        };
        if (c.error !== undefined) {
            status.error = c.error;
        }
        return status;
    });
}

/** Check if there are any configured MCP servers */
export function hasMcpServers(): boolean {
    return clients.size > 0;
}

/** Get all server names (for status display) */
export function getMcpServerNames(): string[] {
    return [...clients.keys()];
}
