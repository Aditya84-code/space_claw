/**
 * setup.ts — /setup command conversation flow
 *
 * State machine: each step sends a question and waits for a text reply.
 * Answers are saved as Core Memory facts. "skip" skips any question.
 * Re-running /setup overwrites existing answers.
 */

import type { Context } from "grammy";
import {
    getSetupStep,
    setSetupStep,
    clearSetupState,
    setCoreMemory,
} from "./core-memory.js";
import { logger } from "./logger.js";

/** Each setup step: the question to ask and the key/label to store the answer under */
const SETUP_STEPS: Array<{ key: string; label: string; question: string }> = [
    {
        key: "owner_name",
        label: "Owner's name",
        question: "What's your name?",
    },
    {
        key: "owner_work",
        label: "What they do",
        question: "What do you do? (job, projects, what keeps you busy)",
    },
    {
        key: "owner_location",
        label: "Where they're based",
        question: "Where are you based?",
    },
    {
        key: "owner_goals",
        label: "Current goals and projects",
        question: "What are your main goals or active projects right now?",
    },
    {
        key: "owner_interests",
        label: "Topics they're into",
        question: "What topics are you into? (tech, markets, hobbies, whatever)",
    },
    {
        key: "owner_comms",
        label: "Communication style preference",
        question: "How do you like to communicate? (brief, detailed, casual, blunt...)",
    },
    {
        key: "owner_callme",
        label: "What you want to be called",
        question: "What do you want to call me?",
    },
    {
        key: "owner_people",
        label: "Important people to know about",
        question: "Any important people I should know about? (teammates, family, advisors — whoever matters)",
    },
];

const TOTAL = SETUP_STEPS.length;

/** Progress indicator: "2/8" */
function progress(step: number): string {
    return `[${step + 1}/${TOTAL}]`;
}

/**
 * Start or restart the /setup flow.
 * Sends the first question and sets step=0 in the DB.
 */
export async function startSetup(ctx: Context): Promise<void> {
    const chatId = ctx.chat!.id;
    setSetupStep(chatId, 0);

    logger.info("Setup started", { chatId });

    const firstQuestion = SETUP_STEPS[0]?.question ?? "";
    await ctx.reply(
        `🧠 *Space Claw Setup*\n\n` +
        `I'm going to ask you ${TOTAL} quick questions. ` +
        `Your answers become permanent facts I remember in every conversation — even after restarts.\n\n` +
        `Type \`skip\` to skip any question. Send /setup anytime to update.\n\n` +
        `────────────────\n\n` +
        `${progress(0)} ${firstQuestion}`,
        { parse_mode: "Markdown" }
    );
}

/**
 * Handle a text message during an active setup flow.
 * Returns true if the message was consumed by setup, false if setup is not active.
 */
export async function handleSetupReply(ctx: Context): Promise<boolean> {
    const chatId = ctx.chat!.id;
    const currentStep = getSetupStep(chatId);

    // Not in setup mode
    if (currentStep === null) return false;

    const userText = (ctx.message as { text?: string })?.text?.trim() ?? "";
    const stepDef = SETUP_STEPS[currentStep];
    if (!stepDef) {
        clearSetupState(chatId);
        return false;
    }

    // Save the answer (unless skipped)
    if (userText.toLowerCase() !== "skip") {
        setCoreMemory(stepDef.key, stepDef.label, userText);
        logger.info("Core memory saved", { key: stepDef.key, chars: userText.length });
    } else {
        logger.info("Setup step skipped", { key: stepDef.key });
    }

    const nextStep = currentStep + 1;

    // All done
    if (nextStep >= TOTAL) {
        clearSetupState(chatId);
        await ctx.reply(
            `✅ *Setup complete!*\n\n` +
            `I've got your profile loaded. These facts are baked into every conversation from now on — no need to repeat yourself.\n\n` +
            `Run /setup anytime to update anything.`,
            { parse_mode: "Markdown" }
        );
        logger.info("Setup complete", { chatId });
        return true;
    }

    // Advance to next question
    setSetupStep(chatId, nextStep);
    const next = SETUP_STEPS[nextStep];
    if (next) {
        await ctx.reply(`${progress(nextStep)} ${next.question}`);
    }
    return true;
}
