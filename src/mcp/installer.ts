/**
 * mcp/installer.ts — Auto-install MCP server packages before connecting
 *
 * If a server config has an `installCommand`, we run it once before
 * attempting to connect. This handles cases like:
 *   "installCommand": "npm install -g @zapier/mcp"
 *   "installCommand": "npx -y @zapier/mcp@latest --help"
 *
 * npx-based servers don't usually need a separate install step since
 * npx will download on first use. For those, leave installCommand unset.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../logger.js";
import type { McpServerConfig } from "./types.js";

const execAsync = promisify(exec);

/** Timeout for install commands (2 minutes) */
const INSTALL_TIMEOUT_MS = 120_000;

/**
 * Run the server's installCommand if configured.
 * Resolves to true on success or if no install is needed.
 * Never throws — install errors are logged and returned as false.
 */
export async function ensureServerInstalled(
    serverConfig: McpServerConfig
): Promise<boolean> {
    const { name, installCommand } = serverConfig;

    if (!installCommand) {
        // No install needed — npx will handle it on first spawn, or it's pre-installed
        return true;
    }

    logger.info(`[MCP] Installing server "${name}"…`, { installCommand });

    try {
        const { stdout, stderr } = await execAsync(installCommand, {
            timeout: INSTALL_TIMEOUT_MS,
            env: { ...process.env },
        });

        if (stdout.trim()) logger.debug(`[MCP] Install stdout for "${name}"`, { output: stdout.trim().slice(0, 500) });
        if (stderr.trim()) logger.debug(`[MCP] Install stderr for "${name}"`, { output: stderr.trim().slice(0, 500) });

        logger.info(`[MCP] Server "${name}" installed successfully`);
        return true;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[MCP] Install failed for "${name}"`, { error: msg });
        logger.warn(
            `[MCP] "${name}" will be skipped. Check the documentation and installCommand in mcp-servers.json`
        );
        return false;
    }
}

/**
 * Substitute ${VAR} placeholders in env values from process.env.
 * Example: "${ZAPIER_MCP_API_KEY}" → actual value from environment
 */
export function resolveEnvVars(
    env: Record<string, string> | undefined
): Record<string, string> {
    if (!env) return {};
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        resolved[key] = value.replace(/\$\{(\w+)\}/g, (_, varName: string) => {
            return process.env[varName] ?? "";
        });
    }
    return resolved;
}
