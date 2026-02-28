/**
 * logger.ts — Structured, level-aware console logger.
 * Timestamps every line. Never logs secrets.
 */

import { config } from "./config.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const COLORS: Record<LogLevel, string> = {
    debug: "\x1b[90m", // gray
    info: "\x1b[36m",  // cyan
    warn: "\x1b[33m",  // yellow
    error: "\x1b[31m", // red
};

const RESET = "\x1b[0m";

function shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[config.LOG_LEVEL];
}

function format(level: LogLevel, message: string, meta?: unknown): string {
    const ts = new Date().toISOString();
    const color = COLORS[level];
    const label = level.toUpperCase().padEnd(5);
    const metaStr = meta !== undefined ? ` ${JSON.stringify(meta)}` : "";
    return `${color}[${ts}] ${label}${RESET} ${message}${metaStr}`;
}

export const logger = {
    debug(message: string, meta?: unknown) {
        if (shouldLog("debug")) console.debug(format("debug", message, meta));
    },
    info(message: string, meta?: unknown) {
        if (shouldLog("info")) console.info(format("info", message, meta));
    },
    warn(message: string, meta?: unknown) {
        if (shouldLog("warn")) console.warn(format("warn", message, meta));
    },
    error(message: string, meta?: unknown) {
        if (shouldLog("error")) console.error(format("error", message, meta));
    },
};
