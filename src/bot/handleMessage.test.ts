import { describe, it, expect, vi } from "vitest";
import { handleMessage, type Deps } from "./handleMessage.js";
import { PendingActionStore } from "./pendingActions.js";
import { ConversationHistoryStore } from "./history.js";
import { SsrfBlockedError } from "../guardrails/ssrf.js";

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    adapter: { sendMessage: vi.fn() },
    pendingActions: new PendingActionStore(),
    history: new ConversationHistoryStore(),
    readHandlers: { listMonitors: vi.fn(), getMonitorStatus: vi.fn(), getSummary: vi.fn(), getMonitorHistory: vi.fn() },
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

  it("routes get_monitor_history straight through without confirmation", async () => {
    const deps = makeDeps();
    (deps.adapter.sendMessage as any).mockResolvedValue({ kind: "tool_call", toolName: "get_monitor_history", args: { identifier: "a" } });
    (deps.readHandlers.getMonitorHistory as any).mockResolvedValue({ kind: "ok", message: "History for a (https://a.com):\n- 5m ago: ✅ 200, 100ms" });
    const reply = await handleMessage(deps, { ...ctx, text: "show history for a" });
    expect(reply).toContain("History for a");
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

  it("returns a user-facing message instead of throwing when a mutating handler hits the SSRF guardrail", async () => {
    const deps = makeDeps();
    deps.pendingActions.set(ctx.channelId, ctx.userId, {
      toolName: "create_monitor",
      args: { url: "http://169.254.169.254/", intervalSeconds: 60 },
      createdAt: Date.now(),
    });
    (deps.mutatingHandlers.createMonitor as any).mockRejectedValue(
      new SsrfBlockedError("http://169.254.169.254/", "resolves to a blocked IP range"),
    );

    const reply = await handleMessage(deps, { ...ctx, text: "yes" });

    expect(reply.toLowerCase()).toMatch(/private|internal/);
    expect(reply).not.toContain("169.254"); // no raw guardrail internals leaked to the user
  });

  it("returns a generic message (not a rejection) when a handler throws something unexpected", async () => {
    const deps = makeDeps();
    (deps.adapter.sendMessage as any).mockResolvedValue({ kind: "tool_call", toolName: "list_monitors", args: {} });
    (deps.readHandlers.listMonitors as any).mockRejectedValue(new Error("sqlite is on fire"));

    const reply = await handleMessage(deps, { ...ctx, text: "list my monitors" });

    expect(reply.toLowerCase()).toContain("something went wrong");
    expect(reply).not.toContain("sqlite"); // real error is logged server-side, not shown
  });

  it("appends a confirmed mutating action's result to history so a follow-up can resolve against it", async () => {
    const deps = makeDeps();
    const ambiguous = 'Multiple monitors match "shop":\n- https://shop-a.com\n- https://shop-b.com\nWhich one?';
    deps.pendingActions.set(ctx.channelId, ctx.userId, {
      toolName: "pause_monitor",
      args: { identifier: "shop" },
      createdAt: Date.now(),
    });
    (deps.mutatingHandlers.pauseMonitor as any).mockResolvedValue({ kind: "ambiguous", message: ambiguous, candidates: [] });

    const reply = await handleMessage(deps, { ...ctx, text: "yes" });

    expect(reply).toBe(ambiguous);
    const history = deps.history.get(ctx.channelId);
    expect(history.some((turn) => turn.role === "assistant" && turn.text === ambiguous)).toBe(true);
    expect(history.some((turn) => turn.role === "user" && turn.text === "yes")).toBe(true);
  });

  it("also records a successful confirmed action in history", async () => {
    const deps = makeDeps();
    deps.pendingActions.set(ctx.channelId, ctx.userId, { toolName: "delete_monitor", args: { identifier: "a" }, createdAt: Date.now() });
    (deps.mutatingHandlers.deleteMonitor as any).mockResolvedValue({ kind: "ok", message: 'Deleted "a".' });

    await handleMessage(deps, { ...ctx, text: "yes" });

    expect(deps.history.get(ctx.channelId).some((t) => t.role === "assistant" && t.text === 'Deleted "a".')).toBe(true);
  });

  it("rejects gracefully instead of crashing when the adapter returns an unrecognized tool name", async () => {
    const deps = makeDeps();
    (deps.adapter.sendMessage as any).mockResolvedValue({ kind: "tool_call", toolName: "not_a_real_tool", args: {} });
    const reply = await handleMessage(deps, { ...ctx, text: "do something weird" });
    expect(reply.toLowerCase()).toContain("don't know how");
    expect(deps.pendingActions.get(ctx.channelId, ctx.userId)).toBeUndefined();
  });
});
