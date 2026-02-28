/**
 * transcribe.ts — Whisper speech-to-text service
 *
 * Accepts a Telegram file URL (OGG/OPUS voice message), downloads it in
 * memory, and sends it to OpenAI Whisper for transcription.
 *
 * Why in-memory?  No disk I/O, no temp-file cleanup, no permission issues.
 * Telegram voice notes are typically <1 MB so this is safe.
 */

import OpenAI, { toFile } from "openai";
import { config } from "./config.js";
import { logger } from "./logger.js";

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

/**
 * Download an audio file from a URL and transcribe it with Whisper.
 *
 * @param fileUrl   The HTTPS URL of the Telegram voice file
 * @returns         Transcribed text, or null on failure / when feature is off
 */
export async function transcribeVoice(fileUrl: string): Promise<string | null> {
    if (!config.VOICE_TRANSCRIPTION_ENABLED) return null;

    logger.debug("Downloading voice file for transcription", { fileUrl });

    let audioBuffer: Buffer;
    try {
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} fetching voice file`);
        }
        const arrayBuffer = await response.arrayBuffer();
        audioBuffer = Buffer.from(arrayBuffer);
    } catch (err) {
        logger.error("Failed to download voice file", { err: String(err) });
        return null;
    }

    logger.debug("Sending voice to Whisper", { bytes: audioBuffer.length });

    try {
        // Telegram sends voice messages as OGG / OPUS
        const file = await toFile(audioBuffer, "voice.ogg", {
            type: "audio/ogg",
        });

        const transcription = await client.audio.transcriptions.create({
            model: "whisper-1",
            file,
            response_format: "text",
        });

        const text = (transcription as unknown as string).trim();
        logger.info("Whisper transcription complete", { chars: text.length });
        return text || null;
    } catch (err) {
        logger.error("Whisper transcription failed", { err: String(err) });
        return null;
    }
}
