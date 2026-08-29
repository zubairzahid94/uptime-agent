import "dotenv/config";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { GoogleGenAI } from "@google/genai";
import { GeminiAdapter } from "../llm/geminiAdapter.js";
import { PendingActionStore } from "./pendingActions.js";
import { ConversationHistoryStore } from "./history.js";
import { renderAlertMessage } from "./templates.js";
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
    await message.reply(reply);
  } catch (err) {
    console.error("failed to handle message", err);
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

setInterval(() => {
  runSchedulerTick({
    onStateChange: (monitor, newStatus) => {
      // Same reasoning as messageCreate above: .catch here, not `void`, so a failed DM
      // (e.g. owner has DMs closed) logs instead of crashing the process.
      notifyOwner(renderAlertMessage(monitor, newStatus)).catch((err) => console.error("failed to notify owner", err));
    },
  }).catch((err) => console.error("scheduler tick failed", err));
}, SCHEDULER_TICK_MS);

client.login(DISCORD_TOKEN);
