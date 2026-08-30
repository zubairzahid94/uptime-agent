import "dotenv/config";
import { Client, GatewayIntentBits, Partials, type Message } from "discord.js";
import { GoogleGenAI } from "@google/genai";
import { GeminiAdapter } from "../llm/geminiAdapter.js";
import { PendingActionStore } from "./pendingActions.js";
import { ConversationHistoryStore } from "./history.js";
import { renderAlertMessage, chunkMessage } from "./templates.js";
import { logger } from "../logger.js";
import { handleMessage } from "./handleMessage.js";
import { runSchedulerTick } from "../scheduler/tick.js";
import * as readHandlers from "../tools/readHandlers.js";
import * as mutatingHandlers from "../tools/mutatingHandlers.js";

const OWNER_ID = process.env.OWNER_DISCORD_ID;
if (!OWNER_ID) throw new Error("OWNER_DISCORD_ID env var is required");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY env var is required");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) throw new Error("DISCORD_TOKEN env var is required");

const genAi = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const deps = {
  adapter: new GeminiAdapter(genAi),
  pendingActions: new PendingActionStore(),
  history: new ConversationHistoryStore(),
  readHandlers,
  mutatingHandlers,
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

/**
 * Sends a reply, splitting it across messages if it would exceed Discord's 2000-char
 * limit. listMonitors at MAX_MONITORS=50 can comfortably blow past that, and an
 * over-long message.reply() throws, which used to mean the user got nothing at all.
 */
async function sendReply(message: Message, text: string): Promise<void> {
  const body = text.trim() === "" ? "(no response)" : text;
  const [first, ...rest] = chunkMessage(body);
  if (first === undefined) return;
  await message.reply(first);
  for (const chunk of rest) {
    if (message.channel.isSendable()) await message.channel.send(chunk);
    else await message.reply(chunk);
  }
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.guildId) return; // DM-only in v1
  if (message.author.id !== OWNER_ID) return;

  // discord.js does not await listener return values, so an uncaught throw here becomes
  // an unhandled promise rejection, which crashes the whole Node process (Node 15+),
  // taking the scheduler down with it over one bad message. Must not let that happen.
  try {
    const reply = await handleMessage(deps, {
      channelId: message.channelId,
      userId: message.author.id,
      text: message.content,
    });
    await sendReply(message, reply);
  } catch (err) {
    logger.error("failed to handle message", {
      channelId: message.channelId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Reaching here means handleMessage's own try/catch didn't cover it (e.g. Discord
    // itself rejected the send). Say SOMETHING; silence is the worst outcome.
    try {
      await message.reply("Something went wrong handling that.");
    } catch (replyErr) {
      logger.error("failed to send fallback error reply", {
        error: replyErr instanceof Error ? replyErr.message : String(replyErr),
      });
    }
  }
});

const SCHEDULER_TICK_MS = 15_000;

// Declared as a const arrow function (not a hoisted function declaration) so that
// TypeScript's narrowing of OWNER_ID to `string` (from the guard above) carries into
// this closure; a hoisted function declaration loses that narrowing and would require
// a redundant `OWNER_ID!` here instead.
const notifyOwner = async (text: string): Promise<void> => {
  const user = await client.users.fetch(OWNER_ID);
  await user.send(text);
};

// Re-entrancy guard. Without it, a monitor whose connection stalls holds its tick open
// while new ticks keep firing every 15s, and each of those sees the same monitor as
// still due, because lastCheckedAt only advances after the fetch resolves. That risks
// duplicate Check rows and, worse, two overlapping evaluations both crossing the alert
// threshold and firing onStateChange twice, breaking "notify only on real transitions".
let ticking = false;

setInterval(() => {
  if (ticking) {
    logger.warn("scheduler.tick.skipped", { reason: "previous tick still running" });
    return;
  }
  ticking = true;
  runSchedulerTick({
    onStateChange: (monitor, newStatus) => {
      // Same reasoning as messageCreate above: .catch here, not `void`, so a failed DM
      // (e.g. owner has DMs closed) logs instead of crashing the process.
      notifyOwner(renderAlertMessage(monitor, newStatus)).catch((err) =>
        logger.error("failed to notify owner", { error: err instanceof Error ? err.message : String(err) }),
      );
    },
  })
    .catch((err) => logger.error("scheduler tick failed", { error: err instanceof Error ? err.message : String(err) }))
    .finally(() => {
      ticking = false;
    });
}, SCHEDULER_TICK_MS);

client.once("clientReady", (c) => {
  logger.info("discord.ready", { tag: c.user.tag, schedulerTickMs: SCHEDULER_TICK_MS });
});

// An invalid token rejects this promise; unhandled, that kills the process with a raw
// stack trace instead of the clear message the three env-var guards above produce.
client.login(DISCORD_TOKEN).catch((err) => {
  logger.error("Discord login failed", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
