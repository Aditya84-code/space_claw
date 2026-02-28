/**
 * tts.ts — Text-to-Speech service using ElevenLabs
 *
 * Converts a text string to an MP3 audio buffer via ElevenLabs TTS.
 * Returns null when TTS is disabled so callers can skip voice delivery gracefully.
 *
 * Usage:
 *   const audio = await textToSpeech("Hello, world!");
 *   if (audio) { ...send as voice message... }
 */

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { config } from "./config.js";
import { logger } from "./logger.js";

let _client: ElevenLabsClient | null = null;

function getClient(): ElevenLabsClient {
    if (!_client) {
        _client = new ElevenLabsClient({ apiKey: config.ELEVENLABS_API_KEY });
    }
    return _client;
}

/** Max characters we'll send to TTS to avoid huge API bills */
const TTS_CHAR_LIMIT = 4096;

/**
 * Convert text to an MP3 audio Buffer using ElevenLabs TTS.
 * Respects TTS_ENABLED — returns null if the feature is turned off.
 *
 * @param text  The text to synthesise
 * @returns     Buffer containing raw MP3 bytes, or null if TTS is disabled / text is empty
 */
export async function textToSpeech(text: string): Promise<Buffer | null> {
    if (!config.TTS_ENABLED) return null;
    return synthesize(text);
}

/**
 * Like textToSpeech() but always runs as long as ELEVENLABS_API_KEY is set.
 * Used by the voice message handler so that voice-in → voice-out always works
 * even when TTS_ENABLED=false for regular text conversations.
 *
 * @param text  The text to synthesise
 * @returns     Buffer containing raw MP3 bytes, or null on failure / missing key
 */
export async function synthesize(text: string): Promise<Buffer | null> {
    if (!text || text.trim().length === 0) return null;
    if (!config.ELEVENLABS_API_KEY) {
        logger.warn("synthesize() called but ELEVENLABS_API_KEY is not set");
        return null;
    }

    // Truncate if too long
    const trimmed = text.length > TTS_CHAR_LIMIT
        ? text.slice(0, TTS_CHAR_LIMIT) + "…"
        : text;

    logger.debug("Generating TTS audio via ElevenLabs", {
        chars: trimmed.length,
        voiceId: config.ELEVENLABS_VOICE_ID,
    });

    try {
        const client = getClient();

        // convert() returns a ReadableStream<Uint8Array>
        const stream = await client.textToSpeech.convert(
            config.ELEVENLABS_VOICE_ID,
            {
                text: trimmed,
                modelId: "eleven_turbo_v2_5", // fast, high-quality multilingual model
                outputFormat: "mp3_44100_128",
            }
        );

        // Collect all chunks from the ReadableStream into a single Buffer
        const chunks: Uint8Array[] = [];
        const reader = stream.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
        }

        const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
        logger.debug("ElevenLabs TTS audio generated", { bytes: buffer.length });
        return buffer;
    } catch (err) {
        // TTS failure is non-fatal — the text reply has already been sent
        logger.error("ElevenLabs TTS generation failed", { err: String(err) });
        return null;
    }
}
