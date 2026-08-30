import type { LlmAdapter } from "../llm/adapter.js";
import { TOOLS, type ToolName } from "../llm/tools.js";
import { PendingActionStore } from "./pendingActions.js";
import { ConversationHistoryStore } from "./history.js";
import { renderConfirmationPrompt } from "./templates.js";
import * as readHandlersModule from "../tools/readHandlers.js";
import * as mutatingHandlersModule from "../tools/mutatingHandlers.js";
import { SsrfBlockedError } from "../guardrails/ssrf.js";
import { logger } from "../logger.js";

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

/**
 * Turns a thrown handler error into something worth saying to the user.
 *
 * Before this existed, any throw here propagated to the messageCreate listener,
 * whose catch only logged, so the user got no reply at all. The most reachable
 * case by far is confirming a create/edit for a URL the SSRF guardrail rejects.
 */
function userFacingError(err: unknown, toolName: ToolName): string {
  logger.error("tool handler threw", {
    toolName,
    errorName: err instanceof Error ? err.name : typeof err,
    error: err instanceof Error ? err.message : String(err),
  });

  if (err instanceof SsrfBlockedError) {
    switch (err.reason) {
      case "unresolvable":
        return "I can't monitor that URL: I couldn't resolve that hostname. Is it spelled correctly?";
      case "invalid_url":
        return "I can't monitor that URL: it isn't a valid http or https URL.";
      default:
        return "I can't monitor that URL: it resolves to a private or internal address.";
    }
  }
  return "Something went wrong handling that. Please try again.";
}

export async function handleMessage(deps: Deps, ctx: MessageContext): Promise<string> {
  const pending = deps.pendingActions.get(ctx.channelId, ctx.userId);

  if (pending) {
    deps.pendingActions.clear(ctx.channelId, ctx.userId);
    if (isYes(ctx.text)) {
      let reply: string;
      try {
        reply = await runMutatingHandler(deps, pending.toolName, pending.args, ctx);
      } catch (err) {
        reply = userFacingError(err, pending.toolName);
      }
      // The confirmed action's own result must go into history, not just to the user.
      // When it resolves ambiguously the reply IS the candidate list, and a follow-up
      // like "the second one" can only be resolved against context that records it.
      // The "yes" is recorded too, so history doesn't end on two assistant turns.
      deps.history.append(ctx.channelId, { role: "user", text: ctx.text });
      deps.history.append(ctx.channelId, { role: "assistant", text: reply });
      return reply;
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
    let prompt: string;
    try {
      prompt = renderConfirmationPrompt(tool.name, parsed.data);
    } catch (err) {
      return userFacingError(err, tool.name);
    }
    deps.pendingActions.set(ctx.channelId, ctx.userId, { toolName: tool.name, args: parsed.data, createdAt: Date.now() });
    deps.history.append(ctx.channelId, { role: "assistant", text: prompt });
    return prompt;
  }

  let reply: string;
  try {
    reply = await runReadHandler(deps, tool.name, parsed.data);
  } catch (err) {
    reply = userFacingError(err, tool.name);
  }
  deps.history.append(ctx.channelId, { role: "assistant", text: reply });
  return reply;
}
