import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../db/client.js";
import { listMonitors, getMonitorStatus, getSummary, getMonitorHistory } from "./readHandlers.js";
import { shortId } from "./resolveMonitor.js";

describe("read handlers", () => {
  beforeEach(async () => {
    await prisma.check.deleteMany();
    await prisma.monitor.deleteMany();
  });

  it("listMonitors lists all monitors with status", async () => {
    await prisma.monitor.create({ data: { url: "https://a.com", label: "a", intervalSeconds: 60, healthStatus: "up" } });
    const result = await listMonitors();
    expect(result.kind).toBe("ok");
    expect(result.message).toContain("a");
    expect(result.message).toContain("up");
  });

  it("getMonitorStatus returns not_found for no match", async () => {
    const result = await getMonitorStatus({ identifier: "nope" });
    expect(result.kind).toBe("not_found");
  });

  it("getMonitorStatus returns ambiguous with candidate list", async () => {
    await prisma.monitor.create({ data: { url: "https://x.com/a", label: "x-a", intervalSeconds: 60 } });
    await prisma.monitor.create({ data: { url: "https://x.com/b", label: "x-b", intervalSeconds: 60 } });
    const result = await getMonitorStatus({ identifier: "x" });
    expect(result.kind).toBe("ambiguous");
  });

  it("getMonitorStatus's ambiguous message shows each candidate's short id, even when label and url are identical", async () => {
    const m1 = await prisma.monitor.create({ data: { url: "https://httpbin.org/status/200", label: "httpbin.org", intervalSeconds: 60 } });
    const m2 = await prisma.monitor.create({ data: { url: "https://httpbin.org/status/200", label: "httpbin.org", intervalSeconds: 60 } });
    const result = await getMonitorStatus({ identifier: "httpbin" });
    expect(result.kind).toBe("ambiguous");
    expect(result.message).toContain(shortId(m1.id));
    expect(result.message).toContain(shortId(m2.id));
  });

  it("getSummary reports the total count", async () => {
    await prisma.monitor.create({ data: { url: "https://a.com", label: "a", intervalSeconds: 60 } });
    await prisma.monitor.create({ data: { url: "https://b.com", label: "b", intervalSeconds: 60, enabled: false } });
    const result = await getSummary();
    expect(result.message).toContain("2");
  });

  it("getMonitorHistory returns not_found for no match", async () => {
    const result = await getMonitorHistory({ identifier: "nope" });
    expect(result.kind).toBe("not_found");
  });

  it("getMonitorHistory returns ambiguous with candidate list", async () => {
    await prisma.monitor.create({ data: { url: "https://x.com/a", label: "x-a", intervalSeconds: 60 } });
    await prisma.monitor.create({ data: { url: "https://x.com/b", label: "x-b", intervalSeconds: 60 } });
    const result = await getMonitorHistory({ identifier: "x" });
    expect(result.kind).toBe("ambiguous");
  });

  it("getMonitorHistory reports an empty-state message when the monitor has no checks yet", async () => {
    await prisma.monitor.create({ data: { url: "https://a.com", label: "a", intervalSeconds: 120 } });
    const result = await getMonitorHistory({ identifier: "a" });
    expect(result.kind).toBe("ok");
    expect(result.message).toContain("hasn't been checked yet");
    expect(result.message).toContain("120s");
  });

  it("getMonitorHistory lists recent checks most-recent-first with a header naming the resolved monitor", async () => {
    const monitor = await prisma.monitor.create({ data: { url: "https://a.com", label: "a", intervalSeconds: 60 } });
    const now = Date.now();
    await prisma.check.create({ data: { monitorId: monitor.id, success: true, statusCode: 200, latencyMs: 100, timestamp: new Date(now - 20_000) } });
    await prisma.check.create({ data: { monitorId: monitor.id, success: true, statusCode: 200, latencyMs: 120, timestamp: new Date(now - 10_000) } });
    const result = await getMonitorHistory({ identifier: "a" });
    expect(result.kind).toBe("ok");
    expect(result.message).toContain("History for a (https://a.com)");
    const lines = result.message.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("120ms"); // most recent check first
    expect(lines[0]).toContain("✅ 200");
    expect(lines[1]).toContain("100ms");
  });

  it("getMonitorHistory defaults to the 10 most recent checks when no limit is given", async () => {
    const monitor = await prisma.monitor.create({ data: { url: "https://a.com", label: "a", intervalSeconds: 60 } });
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      await prisma.check.create({ data: { monitorId: monitor.id, success: true, statusCode: 200, latencyMs: 100, timestamp: new Date(now - i * 1000) } });
    }
    const result = await getMonitorHistory({ identifier: "a" });
    const lines = result.message.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(10);
  });

  it("getMonitorHistory caps an oversized requested limit at 25", async () => {
    const monitor = await prisma.monitor.create({ data: { url: "https://a.com", label: "a", intervalSeconds: 60 } });
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      await prisma.check.create({ data: { monitorId: monitor.id, success: true, statusCode: 200, latencyMs: 100, timestamp: new Date(now - i * 1000) } });
    }
    const result = await getMonitorHistory({ identifier: "a", limit: 100 });
    const lines = result.message.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(25);
  });

  it("getMonitorHistory marks checks that triggered an alert", async () => {
    const monitor = await prisma.monitor.create({ data: { url: "https://a.com", label: "a", intervalSeconds: 60 } });
    await prisma.check.create({ data: { monitorId: monitor.id, success: false, statusCode: 500, latencyMs: 50, causedAlert: true } });
    const result = await getMonitorHistory({ identifier: "a" });
    expect(result.message).toContain("🔔");
  });

  it("getMonitorHistory truncates a long error message instead of dumping it raw", async () => {
    const monitor = await prisma.monitor.create({ data: { url: "https://a.com", label: "a", intervalSeconds: 60 } });
    const longError = "connection reset ".repeat(20);
    await prisma.check.create({ data: { monitorId: monitor.id, success: false, error: longError, latencyMs: 50 } });
    const result = await getMonitorHistory({ identifier: "a" });
    expect(result.message).toContain("…");
    expect(result.message).not.toContain(longError);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
