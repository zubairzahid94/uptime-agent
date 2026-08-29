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

  const reply = await handleMessage(deps, {
    channelId: message.channelId,
    userId: message.author.id,
    text: message.content,
  });
  await message.reply(reply);
});

const SCHEDULER_TICK_MS = 15_000;

async function notifyOwner(text: string): Promise<void> {
  const user = await client.users.fetch(OWNER_ID!);
  await user.send(text);
}

setInterval(() => {
  runSchedulerTick({
    onStateChange: (monitor, newStatus) => {
      void notifyOwner(renderAlertMessage(monitor, newStatus));
    },
  }).catch((err) => console.error("scheduler tick failed", err));
}, SCHEDULER_TICK_MS);

client.login(DISCORD_TOKEN);
