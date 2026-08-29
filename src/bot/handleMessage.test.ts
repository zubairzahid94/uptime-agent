import { describe, it, expect, vi } from "vitest";
import { handleMessage, type Deps } from "./handleMessage.js";
import { PendingActionStore } from "./pendingActions.js";
import { ConversationHistoryStore } from "./history.js";

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    adapter: { sendMessage: vi.fn() },
    pendingActions: new PendingActionStore(),
    history: new ConversationHistoryStore(),
    readHandlers: { listMonitors: vi.fn(), getMonitorStatus: vi.fn(), getSummary: vi.fn() },
    mutatingHandlers: { createMonitor: vi.fn(), editMonitor: vi.fn(), pauseMonitor: vi.fn(), resumeMonitor: vi.fn(), deleteMonitor: vi.fn() },
    ...overrides,
  } as Deps;
}

const ctx = { channelId: "dm-1", userId: "owner-1", text: "" };

describe("handleMessage", () => {
  it("routes a read-only tool call straight through without confirmation", async () => {
    const deps = makeDeps();
    (deps.adapter.sendMessage as any).mockResolvedValue({ kind: "tool_call", toolName: "list_monitors", args: {} });
    (deps.readHandlers.listMonitors as any).mockResolvedValue({ kind: "ok", message: "no monitors" });
    const reply = await handleMessage(deps, { ...ctx, text: "list my monitors" });
    expect(reply).toBe("no monitors");
    expect(deps.pendingActions.get(ctx.channelId, ctx.userId)).toBeUndefined();
  });

  it("stages a mutating tool call behind a deterministic confirmation and does not execute yet", async () => {
    const deps = makeDeps();
    (deps.adapter.sendMessage as any).mockResolvedValue({
      kind: "tool_call", toolName: "delete_monitor", args: { identifier: "a" },
    });
    const reply = await handleMessage(deps, { ...ctx, text: "delete the monitor for a" });
    expect(reply).toContain("delete");
    expect(reply.toLowerCase()).toContain("reply");
    expect(deps.mutatingHandlers.deleteMonitor).not.toHaveBeenCalled();
    expect(deps.pendingActions.get(ctx.channelId, ctx.userId)?.toolName).toBe("delete_monitor");
  });

  it("executes the pending mutating action on a 'yes' reply", async () => {
    const deps = makeDeps();
    deps.pendingActions.set(ctx.channelId, ctx.userId, { toolName: "delete_monitor", args: { identifier: "a" }, createdAt: Date.now() });
    (deps.mutatingHandlers.deleteMonitor as any).mockResolvedValue({ kind: "ok", message: "Deleted \"a\"." });
    const reply = await handleMessage(deps, { ...ctx, text: "yes" });
    expect(deps.mutatingHandlers.deleteMonitor).toHaveBeenCalledWith({ identifier: "a" }, { channelId: ctx.channelId, performedBy: ctx.userId });
    expect(reply).toContain("Deleted");
    expect(deps.pendingActions.get(ctx.channelId, ctx.userId)).toBeUndefined();
  });

  it("discards a pending action and reinterprets an off-script reply as a fresh command", async () => {
    const deps = makeDeps();
    deps.pendingActions.set(ctx.channelId, ctx.userId, { toolName: "delete_monitor", args: { identifier: "a" }, createdAt: Date.now() });
    (deps.adapter.sendMessage as any).mockResolvedValue({ kind: "tool_call", toolName: "list_monitors", args: {} });
    (deps.readHandlers.listMonitors as any).mockResolvedValue({ kind: "ok", message: "no monitors" });
    const reply = await handleMessage(deps, { ...ctx, text: "actually just show me the list" });
    expect(deps.mutatingHandlers.deleteMonitor).not.toHaveBeenCalled();
    expect(reply).toBe("no monitors");
    expect(deps.pendingActions.get(ctx.channelId, ctx.userId)).toBeUndefined();
  });

  it("passes through a plain-text (clarifying question) adapter response verbatim", async () => {
    const deps = makeDeps();
    (deps.adapter.sendMessage as any).mockResolvedValue({ kind: "text", text: "Which monitor did you mean?" });
    const reply = await handleMessage(deps, { ...ctx, text: "stop the monitor" });
    expect(reply).toBe("Which monitor did you mean?");
  });

  it("does not send the current message to the adapter twice (once in history, once as userMessage)", async () => {
    const deps = makeDeps();
    deps.history.append(ctx.channelId, { role: "user", text: "earlier message" });
    (deps.adapter.sendMessage as any).mockResolvedValue({ kind: "text", text: "ok" });
    await handleMessage(deps, { ...ctx, text: "the new message" });
    const [historyArg, userMessageArg] = (deps.adapter.sendMessage as any).mock.calls[0];
    expect(userMessageArg).toBe("the new message");
    expect(historyArg.some((turn: any) => turn.text === "the new message")).toBe(false);
  });

  it("rejects gracefully instead of crashing when the adapter returns an unrecognized tool name", async () => {
    const deps = makeDeps();
    (deps.adapter.sendMessage as any).mockResolvedValue({ kind: "tool_call", toolName: "not_a_real_tool", args: {} });
    const reply = await handleMessage(deps, { ...ctx, text: "do something weird" });
    expect(reply.toLowerCase()).toContain("don't know how");
    expect(deps.pendingActions.get(ctx.channelId, ctx.userId)).toBeUndefined();
  });
});
