/**
 * core-memory.ts — Always-on facts about the owner
 *
 * Core memories are key/value facts saved from /setup (and potentially other
 * sources in future). Unlike regular notes they are:
 *   - Always injected into EVERY system prompt, no semantic search needed
 *   - Keyed by a stable slug (e.g. "owner_name") so /setup can overwrite them
 *   - Survived bot restarts (SQLite-backed)
 *
 * Schema additions (migrations handled at startup):
 *   core_memories(key TEXT PRIMARY KEY, label TEXT, value TEXT, ts INTEGER)
 *   setup_state(chat_id INTEGER PRIMARY KEY, step INTEGER)
 */

import { db } from "./memory.js";
import { logger } from "./logger.js";

// ── Schema migration ──────────────────────────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS core_memories (
        key   TEXT    PRIMARY KEY,
        label TEXT    NOT NULL,
        value TEXT    NOT NULL,
        ts    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS setup_state (
        chat_id INTEGER PRIMARY KEY,
        step    INTEGER NOT NULL DEFAULT 0
    );
`);

logger.info("Core memory tables ready");

// ── Core memory CRUD ─────────────────────────────────────────────────────────

export interface CoreMemory {
    key: string;
    label: string;
    value: string;
}

const stmtUpsert = db.prepare<[string, string, string]>(
    `INSERT INTO core_memories (key, label, value)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET label = excluded.label, value = excluded.value, ts = unixepoch()`
);

const stmtAll = db.prepare<[], CoreMemory>(
    "SELECT key, label, value FROM core_memories ORDER BY rowid ASC"
);

const stmtDelete = db.prepare<[string]>(
    "DELETE FROM core_memories WHERE key = ?"
);

/** Upsert a core memory fact */
export function setCoreMemory(key: string, label: string, value: string): void {
    stmtUpsert.run(key, label, value);
}

/** Return all core memory facts (used by agent to build system prompt) */
export function getAllCoreMemories(): CoreMemory[] {
    return stmtAll.all();
}

/** Delete a core memory by key */
export function deleteCoreMemory(key: string): void {
    stmtDelete.run(key);
}

// ── Setup conversation state ──────────────────────────────────────────────────

const stmtGetStep = db.prepare<[number], { step: number }>(
    "SELECT step FROM setup_state WHERE chat_id = ?"
);

const stmtSetStep = db.prepare<[number, number]>(
    `INSERT INTO setup_state (chat_id, step)
     VALUES (?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET step = excluded.step`
);

const stmtClearStep = db.prepare<[number]>(
    "DELETE FROM setup_state WHERE chat_id = ?"
);

/** Returns the current setup step for a chat, or null if not in setup */
export function getSetupStep(chatId: number): number | null {
    const row = stmtGetStep.get(chatId);
    return row ? row.step : null;
}

/** Save the current setup step */
export function setSetupStep(chatId: number, step: number): void {
    stmtSetStep.run(chatId, step);
}

/** Clear setup state (setup complete or cancelled) */
export function clearSetupState(chatId: number): void {
    stmtClearStep.run(chatId);
}
