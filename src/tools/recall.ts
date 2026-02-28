/**
 * tools/recall.ts — Search saved notes using semantic vector search (primary)
 * with FTS5 keyword search as graceful fallback.
 *
 * Search pipeline:
 *   1. Embed the query via OpenAI text-embedding-3-small
 *   2. Run cosine similarity search against Supabase pgvector memories table
 *   3. If Supabase unconfigured or returns 0 results → fall back to FTS5
 *   4. Deduplicate results from both sources by title (case-insensitive)
 *   5. Return up to 5 notes
 */

import type { ToolDefinition } from "./index.js";
import { searchNotes } from "../memory.js";
import { semanticSearch, isSupabaseConfigured } from "../semantic-memory.js";

export const recallTool: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "recall",
            description:
                "Search persistent memory for notes that match the meaning of a query — " +
                "not just exact keywords. Use this when the owner asks about anything they " +
                "may have told you before. Returns up to 5 matching notes.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description:
                            "A natural-language description of what you are looking for. " +
                            "Full sentences work best (e.g. 'what are my fitness goals?').",
                    },
                },
                required: ["query"],
                additionalProperties: false,
            },
        },
    },

    async execute(args) {
        const query = String(args["query"] ?? "").trim();
        if (!query) return "Error: query is required.";

        // ── 1. Semantic search (pgvector) ──────────────────────────────────
        const semanticResults = await semanticSearch(query, 5);

        // ── 2. FTS5 keyword fallback ───────────────────────────────────────
        const keywordResults =
            semanticResults.length === 0
                ? searchNotes(query, 5)   // only hit FTS5 if semantic returned nothing
                : [];

        // ── 3. Merge + deduplicate by title (semantic first = higher priority) ──
        const seen = new Set<string>();
        const merged: { title: string; body: string }[] = [];

        for (const r of [...semanticResults, ...keywordResults]) {
            const key = r.title.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                merged.push({ title: r.title, body: r.body });
            }
        }

        if (merged.length === 0) {
            const method = isSupabaseConfigured() ? "semantic" : "keyword";
            return `No notes found matching "${query}" (searched via ${method}).`;
        }

        const source = isSupabaseConfigured() ? "🔍 semantic" : "📝 keyword";
        const formatted = merged
            .slice(0, 5)
            .map((n, i) => `${i + 1}. **${n.title}**: ${n.body}`)
            .join("\n");

        return `Found ${merged.length} note(s) [${source} search]:\n${formatted}`;
    },
};
