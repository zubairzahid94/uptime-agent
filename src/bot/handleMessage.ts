import type { LlmAdapter } from "../llm/adapter.js";
import { TOOLS, type ToolName } from "../llm/tools.js";
import { PendingActionStore } from "./pendingActions.js";
import { ConversationHistoryStore } from "./history.js";
import { renderConfirmationPrompt } from "./templates.js";
import * as readHandlersModule from "../tools/readHandlers.js";
import * as mutatingHandlersModule from "../tools/mutatingHandlers.js";

export interface Deps {
  adapter: Pick<LlmAdapter, "sendMessage">;
  pendingActions: PendingActionStore;
  history: ConversationHistoryStore;
  readHandlers: Pick<typeof readHandlersModule, "listMonitors" | "getMonitorStatus" | "getSummary">;
  mutatingHandlers: Pick<typeof mutatingHandlersModule, "createMonitor" | "editMonitor" | "pauseMonitor" | "resumeMonitor" | "deleteMonitor">;
}

interface MessageContext {
  channelId: string;
  userId: string;
  text: string;
}

function isYes(text: string): boolean {
  return text.trim().toLowerCase() === "yes";
}

async function runMutatingHandler(deps: Deps, toolName: ToolName, args: unknown, ctx: MessageContext): Promise<string> {
  const actionCtx = { channelId: ctx.channelId, performedBy: ctx.userId };
  switch (toolName) {
    case "create_monitor": return (await deps.mutatingHandlers.createMonitor(args as any, actionCtx)).message;
    case "edit_monitor": return (await deps.mutatingHandlers.editMonitor(args as any, actionCtx)).message;
    case "pause_monitor": return (await deps.mutatingHandlers.pauseMonitor(args as any, actionCtx)).message;
    case "resume_monitor": return (await deps.mutatingHandlers.resumeMonitor(args as any, actionCtx)).message;
    case "delete_monitor": return (await deps.mutatingHandlers.deleteMonitor(args as any, actionCtx)).message;
    default: throw new Error(`runMutatingHandler: ${toolName} is not mutating`);
  }
}

async function runReadHandler(deps: Deps, toolName: ToolName, args: unknown): Promise<string> {
  switch (toolName) {
    case "list_monitors": return (await deps.readHandlers.listMonitors()).message;
    case "get_monitor_status": return (await deps.readHandlers.getMonitorStatus(args as any)).message;
    case "get_summary": return (await deps.readHandlers.getSummary()).message;
    default: throw new Error(`runReadHandler: ${toolName} is not read-only`);
  }
}

export async function handleMessage(deps: Deps, ctx: MessageContext): Promise<string> {
  const pending = deps.pendingActions.get(ctx.channelId, ctx.userId);

  if (pending) {
    deps.pendingActions.clear(ctx.channelId, ctx.userId);
    if (isYes(ctx.text)) {
      return runMutatingHandler(deps, pending.toolName, pending.args, ctx);
    }
    // any off-script reply falls through to fresh interpretation below
  }

  // Fetch prior history BEFORE appending the current turn: the adapter's sendMessage(history, userMessage)
  // treats `userMessage` as the final turn itself, so `history` must hold only what came before it,
  // otherwise the current message is sent to the LLM twice (once inside history, once as userMessage).
  const priorHistory = deps.history.get(ctx.channelId);
  deps.history.append(ctx.channelId, { role: "user", text: ctx.text });
  const result = await deps.adapter.sendMessage(priorHistory, ctx.text);

  if (result.kind === "text") {
    deps.history.append(ctx.channelId, { role: "assistant", text: result.text });
    return result.text;
  }

  const tool = TOOLS[result.toolName];
  if (!tool) {
    return `Sorry, I don't know how to do "${result.toolName}".`;
  }
  const parsed = tool.schema.safeParse(result.args);
  if (!parsed.success) {
    return `Sorry, I couldn't understand that request well enough to act on it (${parsed.error.issues[0]?.message}).`;
  }

  if (tool.mutating) {
    deps.pendingActions.set(ctx.channelId, ctx.userId, { toolName: tool.name, args: parsed.data, createdAt: Date.now() });
    const prompt = renderConfirmationPrompt(tool.name, parsed.data);
    deps.history.append(ctx.channelId, { role: "assistant", text: prompt });
    return prompt;
  }

  const reply = await runReadHandler(deps, tool.name, parsed.data);
  deps.history.append(ctx.channelId, { role: "assistant", text: reply });
  return reply;
}
