/**
 * semantic-memory.ts — Supabase pgvector semantic memory layer
 *
 * Provides:
 *   - upsertMemory(title, body)  : embed & store a note in Supabase pgvector
 *   - semanticSearch(query, k)   : find the top-K most semantically similar memories
 *   - isSupabaseConfigured()     : guard — returns false if env vars are missing
 *
 * Deduplication strategy:
 *   - Notes are keyed by lower(title) via a UNIQUE index in Supabase.
 *   - upsertMemory uses ON CONFLICT DO UPDATE so re-saving a fact just
 *     refreshes its embedding and body — never creates a duplicate.
 *
 * Graceful degradation:
 *   - Every exported function checks isSupabaseConfigured() first.
 *   - On any error, we log and return a safe empty result — never throw.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { config } from "./config.js";
import { logger } from "./logger.js";

// ── Embedding model ──────────────────────────────────────────────────────────

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

// ── Lazy Supabase client ─────────────────────────────────────────────────────

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
    if (!isSupabaseConfigured()) return null;
    if (!_supabase) {
        _supabase = createClient(
            config.SUPABASE_URL as string,
            config.SUPABASE_SERVICE_ROLE_KEY,
            { auth: { persistSession: false } }
        );
    }
    return _supabase;
}

// ── Lazy OpenAI client (reuse if caller already created one) ─────────────────

let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
    if (!_openai) _openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    return _openai;
}

// ── Public helpers ───────────────────────────────────────────────────────────

/**
 * Returns true only when both Supabase env vars are present AND
 * the SEMANTIC_MEMORY_ENABLED flag is on.
 */
export function isSupabaseConfigured(): boolean {
    return (
        config.SEMANTIC_MEMORY_ENABLED &&
        typeof config.SUPABASE_URL === "string" &&
        config.SUPABASE_URL.length > 0 &&
        config.SUPABASE_SERVICE_ROLE_KEY.length > 0
    );
}

/**
 * Generate an embedding vector for the given text.
 * Uses OpenAI text-embedding-3-small (1536 dims, ~$0.02/M tokens).
 */
export async function getEmbedding(text: string): Promise<number[]> {
    const response = await getOpenAI().embeddings.create({
        model: EMBEDDING_MODEL,
        input: text.slice(0, 8192), // safety trim
        dimensions: EMBEDDING_DIMENSIONS,
    });
    return response.data[0]!.embedding;
}

export interface MemoryRecord {
    title: string;
    body: string;
    similarity?: number;
}

/**
 * Embed a note and upsert it into Supabase.
 * If a memory with the same title already exists it is updated in-place
 * (body refreshed, embedding refreshed, updated_at bumped).
 * Returns true on success, false on any error.
 */
export async function upsertMemory(
    title: string,
    body: string
): Promise<boolean> {
    if (!isSupabaseConfigured()) return false;
    const supabase = getSupabase()!;

    try {
        const embedding = await getEmbedding(`${title}: ${body}`);

        const { error } = await supabase.rpc("upsert_memory", {
            p_title: title,
            p_body: body,
            p_embedding: embedding,
        });

        if (error) {
            logger.warn("Supabase upsertMemory error", { error: error.message });
            return false;
        }

        logger.debug("Memory upserted to Supabase", { title });
        return true;
    } catch (err) {
        logger.warn("upsertMemory threw", { err: String(err) });
        return false;
    }
}

/**
 * Embed `query` and return the top-K most semantically similar memories
 * from Supabase using cosine distance (<=>).
 * Returns an empty array on any error or when Supabase is unconfigured.
 */
export async function semanticSearch(
    query: string,
    limit = 5
): Promise<MemoryRecord[]> {
    if (!isSupabaseConfigured()) return [];
    const supabase = getSupabase()!;

    try {
        const embedding = await getEmbedding(query);

        const { data, error } = await supabase.rpc("search_memories", {
            query_embedding: embedding,
            match_count: limit,
        });

        if (error) {
            logger.warn("Supabase semanticSearch error", { error: error.message });
            return [];
        }

        return (data as { title: string; body: string; similarity: number }[]).map(
            (r) => ({ title: r.title, body: r.body, similarity: r.similarity })
        );
    } catch (err) {
        logger.warn("semanticSearch threw", { err: String(err) });
        return [];
    }
}
