/**
 * tools/remember.ts — Persist a named note to the memory DB.
 *
 * The LLM calls this whenever the owner asks it to "remember" something.
 * Notes are stored in the `notes` table and indexed by FTS5 for fast recall.
 */

import type { ToolDefinition } from "./index.js";
import { saveNote } from "../memory.js";

export const rememberTool: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "remember",
            description:
                "Save a named note to persistent memory. " +
                "Use this whenever the owner asks you to remember something. " +
                "If a note with the same title already exists it is overwritten.",
            parameters: {
                type: "object",
                properties: {
                    title: {
                        type: "string",
                        description:
                            "A short, descriptive title for the note (e.g. 'favorite color', 'gym schedule').",
                    },
                    body: {
                        type: "string",
                        description: "The content to remember.",
                    },
                },
                required: ["title", "body"],
                additionalProperties: false,
            },
        },
    },

    async execute(args) {
        const title = String(args["title"] ?? "").trim();
        const body = String(args["body"] ?? "").trim();

        if (!title || !body) {
            return "Error: both title and body are required.";
        }

        saveNote(title, body);
        return `✅ Remembered: **${title}**`;
    },
};
