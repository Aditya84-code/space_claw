/**
 * tools/soul.ts — Self-improvement tools for Space Claw
 *
 * Gives the agent the ability to read and update its own soul.md personality
 * file at runtime. Changes take effect immediately (hot-reload via reloadSoul())
 * — no bot restart required.
 *
 * Two tools:
 *   soul_read   — Return the current soul.md contents
 *   soul_update — Append a new rule OR replace a named section
 *
 * Security:
 *   - Writes are limited to soul.md only — no arbitrary file paths accepted
 *   - Content is trimmed and length-capped (16 KB) before writing
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "../logger.js";
import { reloadSoul } from "../agent.js";
import type { ToolDefinition } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUL_PATH = join(__dirname, "..", "..", "soul.md");
const MAX_SOUL_BYTES = 16_384; // 16 KB ceiling

// ── Tool: soul_read ──────────────────────────────────────────────────────────

export const soulReadTool: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "soul_read",
            description:
                "Read the current contents of soul.md — the personality and " +
                "behavioural instruction file that shapes how Space Claw responds. " +
                "Call this before making any edits so you know the existing content.",
            parameters: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
            },
        },
    },

    async execute(_args) {
        if (!existsSync(SOUL_PATH)) {
            return "soul.md does not exist yet. Use soul_update to create it.";
        }
        const content = readFileSync(SOUL_PATH, "utf-8").trim();
        logger.info("soul_read called");
        return `📖 soul.md (${content.length} chars):\n\n${content}`;
    },
};

// ── Tool: soul_update ────────────────────────────────────────────────────────

export const soulUpdateTool: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "soul_update",
            description:
                "Update the soul.md personality file. " +
                "Use mode='append' to add a new rule or preference to the end of the file. " +
                "Use mode='replace' to completely rewrite soul.md with the provided content. " +
                "Changes take effect immediately — no restart needed. " +
                "Always call soul_read first to see the current content before replacing.",
            parameters: {
                type: "object",
                properties: {
                    mode: {
                        type: "string",
                        enum: ["append", "replace"],
                        description:
                            "'append' adds content to the end of the existing file. " +
                            "'replace' overwrites the entire file with the new content.",
                    },
                    content: {
                        type: "string",
                        description:
                            "The text to write. For 'append', this should be the new " +
                            "rule or preference to add. For 'replace', this is the full " +
                            "new soul.md content.",
                    },
                    reason: {
                        type: "string",
                        description:
                            "Brief explanation of why this update is being made " +
                            "(shown in the confirmation message to the owner).",
                    },
                },
                required: ["mode", "content"],
                additionalProperties: false,
            },
        },
    },

    async execute(args) {
        const mode = String(args["mode"] ?? "append").trim() as "append" | "replace";
        const newContent = String(args["content"] ?? "").trim();
        const reason = String(args["reason"] ?? "").trim();

        if (!newContent) return "Error: 'content' cannot be empty.";
        if (!["append", "replace"].includes(mode)) {
            return `Error: 'mode' must be 'append' or 'replace', got "${mode}".`;
        }

        // Read current soul (may not exist yet)
        let current = "";
        if (existsSync(SOUL_PATH)) {
            current = readFileSync(SOUL_PATH, "utf-8").trim();
        }

        let updated: string;
        if (mode === "replace") {
            updated = newContent;
        } else {
            // Append: add a blank line separator if file has content
            updated = current
                ? `${current}\n\n${newContent}`
                : newContent;
        }

        // Guard against runaway writes
        const byteSize = Buffer.byteLength(updated, "utf-8");
        if (byteSize > MAX_SOUL_BYTES) {
            return (
                `❌ soul.md would exceed the ${MAX_SOUL_BYTES / 1024} KB limit ` +
                `(${byteSize} bytes). Consider replacing instead of appending, ` +
                `or trimming older rules first.`
            );
        }

        writeFileSync(SOUL_PATH, updated, "utf-8");
        logger.info("soul_update", { mode, bytes: byteSize, reason });

        // Hot-reload: takes effect in the very next turn
        reloadSoul();

        const modeLabel = mode === "replace" ? "replaced" : "updated";
        const reasonNote = reason ? `\n_Reason: ${reason}_` : "";
        return (
            `✅ soul.md ${modeLabel} (${byteSize} bytes). ` +
            `The new personality is active immediately.` +
            reasonNote
        );
    },
};
