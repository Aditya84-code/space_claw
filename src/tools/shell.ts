/**
 * tools/shell.ts — Shell command execution tool
 *
 * Allows the LLM to run shell commands on the host machine and return
 * stdout + stderr. Guarded by:
 *   - An allowlist of permitted executables (SHELL_ALLOWED_COMMANDS)
 *   - A hard timeout that kills the child process (SHELL_TIMEOUT_MS)
 *   - Output truncation (8 KB) to prevent flooding the bot
 *
 * Security: The bot only responds to ALLOWED_USER_ID, so the attack surface
 *           is already minimal. The allowlist is an additional safety net.
 */

import { spawn } from "child_process";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { ToolDefinition } from "./index.js";

const MAX_OUTPUT_BYTES = 8 * 1024; // 8 KB

/**
 * Parse the executable name from a full command string.
 * Works for "node script.js", "git status", "echo hello" etc.
 */
function parseExecutable(command: string): string {
    return command.trim().split(/\s+/)[0] ?? "";
}

/**
 * Check whether the executable is in the configured allowlist.
 * Comparison is case-insensitive on Windows.
 */
function isAllowed(executable: string): boolean {
    const allowed = config.SHELL_ALLOWED_COMMANDS
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    return allowed.includes(executable.toLowerCase());
}

/**
 * Run a shell command, return { exit_code, stdout, stderr }.
 * Resolves (never rejects) — errors come back as non-zero exit codes.
 */
function runCommand(
    command: string,
    cwd: string
): Promise<{ exit_code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const isWindows = process.platform === "win32";
        const shell = isWindows ? "cmd.exe" : "/bin/sh";
        const shellFlag = isWindows ? "/c" : "-c";

        const child = spawn(shell, [shellFlag, command], {
            cwd,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdoutBuf = "";
        let stderrBuf = "";

        child.stdout?.on("data", (chunk: Buffer) => {
            if (Buffer.byteLength(stdoutBuf) < MAX_OUTPUT_BYTES) {
                stdoutBuf += chunk.toString("utf-8");
            }
        });

        child.stderr?.on("data", (chunk: Buffer) => {
            if (Buffer.byteLength(stderrBuf) < MAX_OUTPUT_BYTES) {
                stderrBuf += chunk.toString("utf-8");
            }
        });

        // Hard timeout: kill the process group if it exceeds the limit
        const timer = setTimeout(() => {
            try { child.kill("SIGKILL"); } catch { /* already exited */ }
            resolve({
                exit_code: -1,
                stdout: stdoutBuf,
                stderr: `[TIMEOUT] Process killed after ${config.SHELL_TIMEOUT_MS}ms\n${stderrBuf}`,
            });
        }, config.SHELL_TIMEOUT_MS);

        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({
                exit_code: code ?? -1,
                stdout: stdoutBuf,
                stderr: stderrBuf,
            });
        });

        child.on("error", (err) => {
            clearTimeout(timer);
            resolve({ exit_code: -1, stdout: "", stderr: String(err) });
        });
    });
}

export const shellExecTool: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "shell_exec",
            description:
                "Execute a shell command on the host machine and return stdout + stderr. " +
                "Only executables in the configured allowlist are permitted. " +
                "Use this for running scripts, checking system state, or any automation task. " +
                "Always prefer specific, safe commands. Avoid destructive operations unless explicitly asked.",
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description:
                            "The full command to run, e.g. 'git status' or 'node scripts/build.js'.",
                    },
                    cwd: {
                        type: "string",
                        description:
                            "Working directory for the command. Defaults to the project root if omitted.",
                    },
                },
                required: ["command"],
                additionalProperties: false,
            },
        },
    },

    async execute(args) {
        const command = String(args["command"] ?? "").trim();
        if (!command) return "Error: 'command' is required.";

        const executable = parseExecutable(command);
        if (!isAllowed(executable)) {
            const allowed = config.SHELL_ALLOWED_COMMANDS;
            return (
                `❌ Executable "${executable}" is not in the allowlist.\n` +
                `Allowed: ${allowed}\n` +
                `Set SHELL_ALLOWED_COMMANDS in .env to expand access.`
            );
        }

        const cwd = String(args["cwd"] ?? process.cwd());
        logger.info("shell_exec", { command, cwd });

        const { exit_code, stdout, stderr } = await runCommand(command, cwd);

        // Trim outputs to avoid flooding
        const trimmedStdout = stdout.slice(0, MAX_OUTPUT_BYTES);
        const trimmedStderr = stderr.slice(0, MAX_OUTPUT_BYTES);

        const parts: string[] = [`exit_code: ${exit_code}`];
        if (trimmedStdout) parts.push(`stdout:\n${trimmedStdout}`);
        if (trimmedStderr) parts.push(`stderr:\n${trimmedStderr}`);
        if (!trimmedStdout && !trimmedStderr) parts.push("(no output)");

        return parts.join("\n\n");
    },
};
