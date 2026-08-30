import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import dns from "node:dns/promises";
import { prisma } from "../db/client.js";
import { handleMessage, type Deps } from "./handleMessage.js";
import { PendingActionStore } from "./pendingActions.js";
import { ConversationHistoryStore } from "./history.js";
import type { AdapterResult } from "../llm/adapter.js";
// The point of this file: the REAL handler modules against the REAL database.
// Every other test in the suite mocks at one of these boundaries, which is how
// review findings #3, #4 and #5 survived twenty task-scoped reviews.
import * as readHandlers from "../tools/readHandlers.js";
import * as mutatingHandlers from "../tools/mutatingHandlers.js";

/** A scripted stand-in for the LLM: returns queued results in order. */
class FakeAdapter {
  private queue: AdapterResult[] = [];
  readonly calls: Array<{ historyLength: number; userMessage: string }> = [];

  queueResult(result: AdapterResult): this {
    this.queue.push(result);
    return this;
  }

  async sendMessage(history: { role: string; text: string }[], userMessage: string): Promise<AdapterResult> {
    this.calls.push({ historyLength: history.length, userMessage });
    const next = this.queue.shift();
    if (!next) throw new Error("FakeAdapter: no queued result for this call");
    return next;
  }
}

const ctx = { channelId: "dm-integration", userId: "owner-1", text: "" };

function makeDeps(adapter: FakeAdapter): Deps {
  return {
    adapter: adapter as unknown as Deps["adapter"],
    pendingActions: new PendingActionStore(),
    history: new ConversationHistoryStore(),
    readHandlers,
    mutatingHandlers,
  };
}

describe("handleMessage (integration: real handlers, real DB)", () => {
  beforeEach(async () => {
    await prisma.check.deleteMany();
    await prisma.action.deleteMany();
    await prisma.monitor.deleteMany();
    // Public IPv4 for every hostname, so the SSRF guardrail is exercised for real
    // without the suite depending on the network. IP-literal URLs bypass this and
    // still take the real blocked-range path.
    vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("create -> confirm -> the monitor really exists in the DB, with an audit row", async () => {
    const adapter = new FakeAdapter().queueResult({
      kind: "tool_call",
      toolName: "create_monitor",
      args: { url: "https://example.com/health", intervalSeconds: 120, label: "example" },
    });
    const deps = makeDeps(adapter);

    const confirmation = await handleMessage(deps, { ...ctx, text: "monitor example.com every 2 minutes" });
    expect(confirmation).toContain("https://example.com/health");
    expect(confirmation.toLowerCase()).toContain("reply");
    // nothing written until confirmed
    expect(await prisma.monitor.count()).toBe(0);

    const result = await handleMessage(deps, { ...ctx, text: "yes" });
    expect(result).toContain("Created");

    const monitors = await prisma.monitor.findMany();
    expect(monitors).toHaveLength(1);
    expect(monitors[0]!.url).toBe("https://example.com/health");
    expect(monitors[0]!.label).toBe("example");
    expect(monitors[0]!.intervalSeconds).toBe(120);
    expect(monitors[0]!.expectedStatus).toBe(200);

    const actions = await prisma.action.findMany();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.toolName).toBe("create_monitor");
    expect(actions[0]!.result).toBe("created");
    expect(actions[0]!.performedBy).toBe(ctx.userId);

    // the confirmed result reached history too (review finding #4)
    expect(deps.history.get(ctx.channelId).some((t) => t.role === "assistant" && t.text.includes("Created"))).toBe(true);
  });

  it("an ambiguous identifier returns the real candidate list AND leaves it in history for a follow-up", async () => {
    await prisma.monitor.create({ data: { url: "https://shop-a.com", label: "shop-a", intervalSeconds: 60 } });
    await prisma.monitor.create({ data: { url: "https://shop-b.com", label: "shop-b", intervalSeconds: 60 } });

    const adapter = new FakeAdapter()
      .queueResult({ kind: "tool_call", toolName: "pause_monitor", args: { identifier: "shop" } })
      .queueResult({ kind: "text", text: "Which one did you mean?" });
    const deps = makeDeps(adapter);

    await handleMessage(deps, { ...ctx, text: "stop the shop monitor" });
    const ambiguous = await handleMessage(deps, { ...ctx, text: "yes" });

    expect(ambiguous).toContain("Multiple monitors match");
    expect(ambiguous).toContain("https://shop-a.com");
    expect(ambiguous).toContain("https://shop-b.com");
    // neither monitor was actually paused
    expect(await prisma.monitor.count({ where: { enabled: false } })).toBe(0);

    const history = deps.history.get(ctx.channelId);
    expect(history.some((t) => t.role === "assistant" && t.text.includes("https://shop-b.com"))).toBe(true);

    // a follow-up turn now carries the candidate list to the adapter, which is the
    // whole point: without finding #4's fix the model would see nothing to resolve
    // "the second one" against.
    await handleMessage(deps, { ...ctx, text: "the second one" });
    const followUpCall = adapter.calls[adapter.calls.length - 1]!;
    expect(followUpCall.userMessage).toBe("the second one");
    expect(followUpCall.historyLength).toBeGreaterThan(0);
  });

  it("a blocked URL is rejected with a user-facing message, not a crash, and writes nothing", async () => {
    const adapter = new FakeAdapter().queueResult({
      kind: "tool_call",
      toolName: "create_monitor",
      args: { url: "http://169.254.169.254/", intervalSeconds: 60 },
    });
    const deps = makeDeps(adapter);

    await handleMessage(deps, { ...ctx, text: "monitor http://169.254.169.254/" });
    const result = await handleMessage(deps, { ...ctx, text: "yes" });

    expect(result.toLowerCase()).toMatch(/private|internal/);
    expect(await prisma.monitor.count()).toBe(0);
    expect(await prisma.action.count()).toBe(0);
  });

  it("a read tool runs end to end against the real DB", async () => {
    await prisma.monitor.create({ data: { url: "https://a.com", label: "a", intervalSeconds: 60 } });
    await prisma.monitor.create({ data: { url: "https://b.com", label: "b", intervalSeconds: 60, enabled: false } });

    const adapter = new FakeAdapter().queueResult({ kind: "tool_call", toolName: "get_summary", args: {} });
    const deps = makeDeps(adapter);

    const reply = await handleMessage(deps, { ...ctx, text: "how many monitors do I have?" });
    expect(reply).toContain("2 monitor(s) total");
    expect(reply).toContain("1 active");
    expect(reply).toContain("1 paused");
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
