/**
 * memory.ts — SQLite-backed persistent memory
 *
 * Two concerns:
 *   1. Conversation history  — survives bot restarts (replaces the in-memory Map)
 *   2. Named notes           — free-text facts the LLM can save and search
 *
 * Schema
 * ──────
 *   messages(id, chat_id, role, content, ts)
 *   notes(id, title, body, ts)
 *   notes_fts  ← FTS5 virtual table that mirrors notes for full-text search
 *
 * All operations are synchronous (better-sqlite3 API).
 * The DB file is created automatically on first run.
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { upsertMemory } from "./semantic-memory.js";

// ── Initialise DB ─────────────────────────────────────────────────────────────

function openDb(): Database.Database {
    const dbPath = config.MEMORY_DB_PATH;
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });

    const db = new Database(dbPath);

    // WAL mode for better write performance
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            role    TEXT    NOT NULL,
            content TEXT    NOT NULL,
            ts      INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);

        CREATE TABLE IF NOT EXISTS notes (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT    NOT NULL,
            body  TEXT    NOT NULL,
            ts    INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title,
            body,
            content='notes',
            content_rowid='id'
        );

        -- Keep FTS index in sync with inserts
        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
            INSERT INTO notes_fts(rowid, title, body)
            VALUES (new.id, new.title, new.body);
        END;

        -- Keep FTS index in sync with deletes
        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, body)
            VALUES ('delete', old.id, old.title, old.body);
        END;

        -- Keep FTS index in sync with updates
        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, body)
            VALUES ('delete', old.id, old.title, old.body);
            INSERT INTO notes_fts(rowid, title, body)
            VALUES (new.id, new.title, new.body);
        END;
    `);

    // Migration: add raw_json column if this DB was created before Level 2 fix
    try {
        db.exec("ALTER TABLE messages ADD COLUMN raw_json TEXT");
    } catch {
        // Column already exists — expected on subsequent startups
    }

    logger.info("Memory DB ready", { path: dbPath });
    return db;
}

export const db = openDb();

// ── Conversation history ──────────────────────────────────────────────────────

// Stores the full message JSON so tool_calls / tool_call_id are never lost
const stmtInsertMsg = db.prepare<[number, string, string, string]>(
    "INSERT INTO messages (chat_id, role, content, raw_json) VALUES (?, ?, ?, ?)"
);

const stmtLoadMsgs = db.prepare<[number], { role: string; content: string; raw_json: string | null }>(
    "SELECT role, content, raw_json FROM messages WHERE chat_id = ? ORDER BY id ASC"
);

const stmtDeleteMsgs = db.prepare<[number]>(
    "DELETE FROM messages WHERE chat_id = ?"
);

/**
 * Load the full conversation history for a chat from the DB.
 * Uses raw_json when available to restore all fields (tool_calls, tool_call_id).
 * Falls back to role+content for rows written before the Level 2 fix.
 */
export function loadHistory(chatId: number): ChatCompletionMessageParam[] {
    const rows = stmtLoadMsgs.all(chatId);
    return rows.map((r) => {
        if (r.raw_json) {
            return JSON.parse(r.raw_json) as ChatCompletionMessageParam;
        }
        // Legacy row — reconstruct best-effort (tool messages may be invalid,
        // but /clear will wipe them on the next session)
        return { role: r.role, content: r.content } as unknown as ChatCompletionMessageParam;
    });
}

/**
 * Persist a full updated history snapshot for a chat.
 * Stores the complete message JSON so no fields are ever lost on reload.
 */
export function saveHistory(
    chatId: number,
    messages: ChatCompletionMessageParam[]
): void {
    const persist = db.transaction(() => {
        stmtDeleteMsgs.run(chatId);
        for (const msg of messages) {
            const content =
                typeof msg.content === "string"
                    ? msg.content
                    : JSON.stringify(msg.content ?? "");
            const rawJson = JSON.stringify(msg);
            stmtInsertMsg.run(chatId, msg.role, content, rawJson);
        }
    });
    persist();
}

/**
 * Wipe all conversation messages for a chat (used by /clear).
 */
export function deleteHistory(chatId: number): void {
    stmtDeleteMsgs.run(chatId);
}

// ── Notes (agent-writable memory) ─────────────────────────────────────────────

const stmtInsertNote = db.prepare<[string, string]>(
    "INSERT INTO notes (title, body) VALUES (?, ?)"
);

const stmtAllNotes = db.prepare<[], { id: number; title: string; body: string; ts: number }>(
    "SELECT id, title, body, ts FROM notes ORDER BY ts DESC"
);

const stmtSearchNotes = db.prepare<[string, number], { title: string; body: string; ts: number }>(
    "SELECT n.title, n.body, n.ts FROM notes_fts f JOIN notes n ON n.id = f.rowid WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?"
);

export interface Note {
    title: string;
    body: string;
    ts: number;
}

/**
 * Save a named note. Silently overwrites an existing note with the same title.
 * Also fires an async vector upsert into Supabase pgvector (non-blocking).
 */
export function saveNote(title: string, body: string): void {
    // If title already exists overwrite it
    const existing = db.prepare<[string], { id: number }>(
        "SELECT id FROM notes WHERE lower(title) = lower(?) LIMIT 1"
    ).get(title);

    if (existing) {
        db.prepare<[string, number]>(
            "UPDATE notes SET body = ?, ts = unixepoch() WHERE id = ?"
        ).run(body, existing.id);
        // FTS triggers handle the update
    } else {
        stmtInsertNote.run(title, body);
    }

    // Fire-and-forget: sync to Supabase pgvector in the background.
    // Errors are swallowed inside upsertMemory — never crash the caller.
    void upsertMemory(title, body).catch((err) =>
        logger.warn("Background upsertMemory failed", { err: String(err) })
    );
}

/**
 * Full-text search across all notes using FTS5.
 */
export function searchNotes(query: string, limit = 5): Note[] {
    try {
        return stmtSearchNotes.all(query, limit);
    } catch {
        // FTS5 query syntax errors — return empty rather than crashing
        return [];
    }
}

/**
 * Return all notes (for /memory command).
 */
export function getAllNotes(): { id: number; title: string; body: string; ts: number }[] {
    return stmtAllNotes.all();
}
