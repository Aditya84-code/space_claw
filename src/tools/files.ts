/**
 * tools/files.ts — File system operation tools
 *
 * Provides 6 tools for reading, writing, appending, deleting, listing,
 * and searching files. All operations are constrained by:
 *   - Path allowlisting (FILE_ALLOWED_PATHS) — paths outside are rejected
 *   - Size limits (FILE_MAX_SIZE_BYTES) for read/write operations
 *
 * Paths are always resolved to absolute before the allowlist check,
 * so directory traversal (../../etc) is blocked automatically.
 */

import {
    readFileSync,
    writeFileSync,
    appendFileSync,
    unlinkSync,
    readdirSync,
    statSync,
    existsSync,
    mkdirSync,
} from "fs";
import { resolve, join, relative, dirname } from "path";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { ToolDefinition } from "./index.js";

// ── Path validation ──────────────────────────────────────────────────────────

/** Returns the list of allowed absolute path prefixes. */
function getAllowedDirs(): string[] {
    return config.FILE_ALLOWED_PATHS
        .split(",")
        .map((p) => resolve(p.trim()))
        .filter(Boolean);
}

/** Resolve and validate that `target` falls within an allowed directory. */
function resolveSafe(target: string): { ok: true; abs: string } | { ok: false; reason: string } {
    const abs = resolve(target);
    const allowed = getAllowedDirs();
    const isAllowed = allowed.some((dir) => abs.startsWith(dir));
    if (!isAllowed) {
        return {
            ok: false,
            reason:
                `❌ Path "${abs}" is outside the allowed directories.\n` +
                `Allowed prefixes: ${allowed.join(", ")}\n` +
                `Set FILE_ALLOWED_PATHS in .env to expand access.`,
        };
    }
    return { ok: true, abs };
}

// ── Tool: file_read ──────────────────────────────────────────────────────────

export const fileReadTool: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "file_read",
            description:
                "Read the contents of a text file. " +
                "Returns the file contents as a string. " +
                "Enforces size limits and path allowlisting.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Path to the file to read (relative or absolute).",
                    },
                    encoding: {
                        type: "string",
                        description: "Text encoding. Defaults to 'utf-8'.",
                        enum: ["utf-8", "utf8", "ascii", "latin1"],
                    },
                },
                required: ["path"],
                additionalProperties: false,
            },
        },
    },

    async execute(args) {
        const target = String(args["path"] ?? "").trim();
        if (!target) return "Error: 'path' is required.";

        const check = resolveSafe(target);
        if (!check.ok) return check.reason;

        if (!existsSync(check.abs)) return `❌ File not found: ${check.abs}`;

        const stat = statSync(check.abs);
        if (!stat.isFile()) return `❌ "${check.abs}" is not a file.`;
        if (stat.size > config.FILE_MAX_SIZE_BYTES) {
            return (
                `❌ File too large: ${stat.size} bytes (limit: ${config.FILE_MAX_SIZE_BYTES} bytes).\n` +
                `Set FILE_MAX_SIZE_BYTES in .env to increase the limit.`
            );
        }

        logger.info("file_read", { path: check.abs });
        const content = readFileSync(check.abs, "utf-8");
        return `📄 ${check.abs} (${stat.size} bytes):\n\n${content}`;
    },
};

// ── Tool: file_write ─────────────────────────────────────────────────────────

export const fileWriteTool: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "file_write",
            description:
                "Write text content to a file, creating it (and any parent directories) if needed. " +
                "Overwrites existing content. Use file_append to add to an existing file.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Path to the file to write.",
                    },
                    content: {
                        type: "string",
                        description: "The text content to write.",
                    },
                },
                required: ["path", "content"],
                additionalProperties: false,
            },
        },
    },

    async execute(args) {
        const target = String(args["path"] ?? "").trim();
        const content = String(args["content"] ?? "");

        if (!target) return "Error: 'path' is required.";

        const check = resolveSafe(target);
        if (!check.ok) return check.reason;

        const byteSize = Buffer.byteLength(content, "utf-8");
        if (byteSize > config.FILE_MAX_SIZE_BYTES) {
            return `❌ Content too large: ${byteSize} bytes (limit: ${config.FILE_MAX_SIZE_BYTES} bytes).`;
        }

        // Ensure parent directory exists
        const parentDir = dirname(check.abs);
        if (parentDir && !existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });

        logger.info("file_write", { path: check.abs, bytes: byteSize });
        writeFileSync(check.abs, content, "utf-8");
        return `✅ Written ${byteSize} bytes to ${check.abs}`;
    },
};

// ── Tool: file_append ────────────────────────────────────────────────────────

export const fileAppendTool: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "file_append",
            description:
                "Append text to the end of a file. Creates the file if it does not exist. " +
                "Use this to add content without overwriting existing data.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Path to the file to append to.",
                    },
                    content: {
                        type: "string",
                        description: "The text content to append.",
                    },
                },
                required: ["path", "content"],
                additionalProperties: false,
            },
        },
    },

    async execute(args) {
        const target = String(args["path"] ?? "").trim();
        const content = String(args["content"] ?? "");

        if (!target) return "Error: 'path' is required.";

        const check = resolveSafe(target);
        if (!check.ok) return check.reason;

        const byteSize = Buffer.byteLength(content, "utf-8");
        logger.info("file_append", { path: check.abs, bytes: byteSize });
        appendFileSync(check.abs, content, "utf-8");
        return `✅ Appended ${byteSize} bytes to ${check.abs}`;
    },
};

// ── Tool: file_delete ────────────────────────────────────────────────────────

export const fileDeleteTool: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "file_delete",
            description:
                "Delete a single file. This operation is irreversible. " +
                "Only files within the allowed paths can be deleted.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Path to the file to delete.",
                    },
                },
                required: ["path"],
                additionalProperties: false,
            },
        },
    },

    async execute(args) {
        const target = String(args["path"] ?? "").trim();
        if (!target) return "Error: 'path' is required.";

        const check = resolveSafe(target);
        if (!check.ok) return check.reason;

        if (!existsSync(check.abs)) return `❌ File not found: ${check.abs}`;

        const stat = statSync(check.abs);
        if (!stat.isFile()) return `❌ "${check.abs}" is not a file (won't delete directories).`;

        logger.info("file_delete", { path: check.abs });
        unlinkSync(check.abs);
        return `🗑️ Deleted ${check.abs}`;
    },
};

// ── Tool: file_list ──────────────────────────────────────────────────────────

interface DirEntry {
    name: string;
    type: "file" | "dir";
    size?: number;
}

function listDir(dir: string, recursive: boolean, depth = 0): DirEntry[] {
    if (depth > 5) return []; // safety depth cap
    const entries: DirEntry[] = [];

    let items: string[];
    try {
        items = readdirSync(dir);
    } catch {
        return [];
    }

    for (const name of items) {
        const abs = join(dir, name);
        let stat;
        try { stat = statSync(abs); } catch { continue; }

        if (stat.isDirectory()) {
            entries.push({ name, type: "dir" });
            if (recursive) {
                const children = listDir(abs, recursive, depth + 1).map((c) => ({
                    ...c,
                    name: `${name}/${c.name}`,
                }));
                entries.push(...children);
            }
        } else {
            entries.push({ name, type: "file", size: stat.size });
        }
    }

    return entries;
}

export const fileListTool: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "file_list",
            description:
                "List files and directories at a given path. " +
                "Supports optional recursive listing. " +
                "Returns a structured listing with file sizes.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "Directory path to list. Defaults to the first allowed path.",
                    },
                    recursive: {
                        type: "boolean",
                        description: "Whether to list subdirectories recursively (max depth 5). Defaults to false.",
                    },
                },
                required: ["path"],
                additionalProperties: false,
            },
        },
    },

    async execute(args) {
        const target = String(args["path"] ?? "").trim();
        if (!target) return "Error: 'path' is required.";

        const check = resolveSafe(target);
        if (!check.ok) return check.reason;

        if (!existsSync(check.abs)) return `❌ Path not found: ${check.abs}`;
        if (!statSync(check.abs).isDirectory()) return `❌ "${check.abs}" is not a directory.`;

        const recursive = Boolean(args["recursive"] ?? false);
        logger.info("file_list", { path: check.abs, recursive });

        const entries = listDir(check.abs, recursive);
        if (entries.length === 0) return `📂 ${check.abs} (empty)`;

        const lines = entries.map((e) => {
            if (e.type === "dir") return `  📁 ${e.name}/`;
            const sizeStr = e.size !== undefined ? ` (${e.size} B)` : "";
            return `  📄 ${e.name}${sizeStr}`;
        });

        return `📂 ${check.abs}:\n${lines.join("\n")}`;
    },
};

// ── Tool: file_search ────────────────────────────────────────────────────────

export const fileSearchTool: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "file_search",
            description:
                "Search for a text pattern within files under a directory. " +
                "Returns matching lines with file paths and line numbers. " +
                "Case-insensitive by default. Limited to text files under the allowed paths.",
            parameters: {
                type: "object",
                properties: {
                    directory: {
                        type: "string",
                        description: "Directory to search in (recursively).",
                    },
                    pattern: {
                        type: "string",
                        description: "Text string or regex pattern to search for.",
                    },
                    case_sensitive: {
                        type: "boolean",
                        description: "Whether the search is case-sensitive. Defaults to false.",
                    },
                    max_results: {
                        type: "number",
                        description: "Maximum number of matching lines to return. Defaults to 50.",
                    },
                },
                required: ["directory", "pattern"],
                additionalProperties: false,
            },
        },
    },

    async execute(args) {
        const dir = String(args["directory"] ?? "").trim();
        const pattern = String(args["pattern"] ?? "").trim();
        if (!dir) return "Error: 'directory' is required.";
        if (!pattern) return "Error: 'pattern' is required.";

        const check = resolveSafe(dir);
        if (!check.ok) return check.reason;

        if (!existsSync(check.abs)) return `❌ Path not found: ${check.abs}`;

        const caseSensitive = Boolean(args["case_sensitive"] ?? false);
        const maxResults = Math.min(Number(args["max_results"] ?? 50), 200);
        let regex: RegExp;

        try {
            regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
        } catch {
            // Fall back to literal string search
            const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            regex = new RegExp(escaped, caseSensitive ? "g" : "gi");
        }

        const absDir = check.abs;
        logger.info("file_search", { dir: absDir, pattern, caseSensitive });

        const results: string[] = [];

        function searchDir(current: string, depth = 0): void {
            if (results.length >= maxResults || depth > 5) return;
            let items: string[];
            try { items = readdirSync(current); } catch { return; }

            for (const name of items) {
                if (results.length >= maxResults) return;
                const abs = join(current, name);
                let stat;
                try { stat = statSync(abs); } catch { continue; }

                if (stat.isDirectory()) {
                    searchDir(abs, depth + 1);
                } else if (stat.isFile() && stat.size <= config.FILE_MAX_SIZE_BYTES) {
                    let text: string;
                    try { text = readFileSync(abs, "utf-8"); } catch { continue; }

                    const lines = text.split("\n");
                    const rel = relative(absDir, abs).replace(/\\/g, "/");

                    for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                        regex.lastIndex = 0;
                        if (regex.test(lines[i]!)) {
                            results.push(`${rel}:${i + 1}: ${lines[i]!.trim()}`);
                        }
                    }
                }
            }
        }

        searchDir(check.abs);

        if (results.length === 0) return `🔍 No matches for "${pattern}" in ${check.abs}`;

        const header = `🔍 Found ${results.length} match(es) for "${pattern}" in ${check.abs}:`;
        const truncNote = results.length >= maxResults ? `\n(limited to ${maxResults} results)` : "";
        return `${header}\n\n${results.join("\n")}${truncNote}`;
    },
};
