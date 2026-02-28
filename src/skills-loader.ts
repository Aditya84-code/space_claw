/**
 * skills-loader.ts — Skills system for Space Claw
 *
 * Skills are markdown files stored in the /skills directory at the project root.
 * Each .md file defines a new capability or domain of knowledge for the agent.
 *
 * On startup, all skills are loaded once and cached. They are then injected into
 * the agent's system prompt so the LLM knows about its extended capabilities.
 *
 * To add a new skill: drop a .md file into /skills and restart the bot.
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { logger } from "./logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Skill {
    /** Filename without extension, e.g. "coding" */
    name: string;
    /** First non-empty, non-heading line from the markdown (used as a one-liner) */
    description: string;
    /** Full raw markdown content */
    content: string;
}

// ── Module-level cache (loaded once on startup) ───────────────────────────────

let _skills: Skill[] = [];
let _loaded = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract a short description from a skill's markdown.
 * Prefers the first blockquote line ("> ..."), then the first non-empty
 * non-heading line, stripping any markdown formatting.
 */
function extractDescription(content: string): string {
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        // Prefer blockquote lines ("> description")
        if (trimmed.startsWith(">")) {
            return trimmed.replace(/^>\s*/, "").trim();
        }

        // Otherwise take the first meaningful line
        return trimmed
            .replace(/^\*+|\*+$/g, "") // strip leading/trailing bold
            .replace(/^_+|_+$/g, "")   // strip leading/trailing italic
            .trim();
    }
    return "No description available.";
}

/**
 * Extract the display name from the first H1 heading, or fall back to filename.
 */
function extractDisplayName(content: string, filename: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    if (match?.[1]) return match[1].trim();
    // Capitalise filename: "coding" → "Coding"
    return filename.charAt(0).toUpperCase() + filename.slice(1);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load all skill markdown files from the given directory.
 * Safe to call at startup; silently skips if the directory doesn't exist.
 */
export function loadSkills(skillsDir?: string): Skill[] {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const dir = skillsDir ?? join(__dirname, "..", "skills");

    if (!existsSync(dir)) {
        logger.info("Skills directory not found — no skills loaded", { dir });
        _skills = [];
        _loaded = true;
        return _skills;
    }

    let files: string[];
    try {
        files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch (err) {
        logger.warn("Could not read skills directory", { dir, err: String(err) });
        _skills = [];
        _loaded = true;
        return _skills;
    }

    const loaded: Skill[] = [];

    for (const file of files) {
        try {
            const content = readFileSync(join(dir, file), "utf-8").trim();
            const filename = file.replace(/\.md$/, "");
            const name = extractDisplayName(content, filename);
            const description = extractDescription(content);
            loaded.push({ name, description, content });
            logger.debug("Skill loaded", { file, name });
        } catch (err) {
            logger.warn("Failed to load skill file — skipping", {
                file,
                err: String(err),
            });
        }
    }

    _skills = loaded;
    _loaded = true;
    logger.info(`✨ ${loaded.length} skill(s) loaded`, {
        skills: loaded.map((s) => s.name),
    });
    return _skills;
}

/**
 * Return the cached list of loaded skills.
 * If loadSkills() hasn't been called yet, returns an empty array.
 */
export function getLoadedSkills(): Skill[] {
    return _skills;
}

/**
 * Build a formatted markdown block to inject into the system prompt.
 * Returns an empty string if no skills are loaded.
 */
export function getSkillsBlock(): string {
    if (!_loaded || _skills.length === 0) return "";

    const skillSections = _skills
        .map((s) => `### ${s.name}\n\n${s.content}`)
        .join("\n\n---\n\n");

    return (
        `\n\n## Loaded Skills\n\n` +
        `The following skills have been loaded and define extended capabilities:\n\n` +
        skillSections
    );
}
