import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../db/client.js";
import * as ssrf from "../guardrails/ssrf.js";
import { createMonitor, editMonitor, pauseMonitor, resumeMonitor, deleteMonitor, deriveLabelFromUrl } from "./mutatingHandlers.js";
import { shortId } from "./resolveMonitor.js";

const ctx = { channelId: "dm-1", performedBy: "owner-1" };

describe("mutating handlers", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(ssrf, "assertUrlIsSafe").mockResolvedValue(undefined);
    await prisma.action.deleteMany();
    await prisma.check.deleteMany();
    await prisma.monitor.deleteMany();
  });

  it("deriveLabelFromUrl extracts the hostname", () => {
    expect(deriveLabelFromUrl("https://hanifautos.com/health")).toBe("hanifautos.com");
  });

  it("createMonitor creates a row, defaults the label, and writes an action", async () => {
    const result = await createMonitor({ url: "https://hanifautos.com", intervalSeconds: 60, expectedStatus: 200 }, ctx);
    expect(result.kind).toBe("ok");
    const monitor = await prisma.monitor.findFirstOrThrow({ where: { url: "https://hanifautos.com" } });
    expect(monitor.label).toBe("hanifautos.com");
    const actions = await prisma.action.findMany();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.toolName).toBe("create_monitor");
  });

  it("createMonitor refuses a URL that already matches an existing monitor, without creating a row or calling the SSRF check", async () => {
    await prisma.monitor.create({ data: { url: "https://httpbin.org/status/200", label: "httpbin.org", intervalSeconds: 60 } });
    const result = await createMonitor({ url: "https://httpbin.org/status/200", intervalSeconds: 60 }, ctx);
    expect(result.kind).toBe("ok");
    expect(result.message.toLowerCase()).toContain("already");
    expect(await prisma.monitor.count()).toBe(1);
    expect(await prisma.action.count()).toBe(0);
    expect(ssrf.assertUrlIsSafe).not.toHaveBeenCalled();
  });

  it("pauseMonitor and resumeMonitor toggle enabled", async () => {
    const m = await prisma.monitor.create({ data: { url: "https://a.com", label: "a", intervalSeconds: 60 } });
    await pauseMonitor({ identifier: "a" }, ctx);
    expect((await prisma.monitor.findUniqueOrThrow({ where: { id: m.id } })).enabled).toBe(false);
    await resumeMonitor({ identifier: "a" }, ctx);
    expect((await prisma.monitor.findUniqueOrThrow({ where: { id: m.id } })).enabled).toBe(true);
  });

  it("editMonitor updates provided fields only", async () => {
    const m = await prisma.monitor.create({ data: { url: "https://a.com", label: "a", intervalSeconds: 60, expectedStatus: 200 } });
    await editMonitor({ identifier: "a", intervalSeconds: 120 }, ctx);
    const updated = await prisma.monitor.findUniqueOrThrow({ where: { id: m.id } });
    expect(updated.intervalSeconds).toBe(120);
    expect(updated.expectedStatus).toBe(200);
  });

  it("deleteMonitor removes the row and writes an action", async () => {
    await prisma.monitor.create({ data: { url: "https://a.com", label: "a", intervalSeconds: 60 } });
    const result = await deleteMonitor({ identifier: "a" }, ctx);
    expect(result.kind).toBe("ok");
    expect(await prisma.monitor.findFirst({ where: { label: "a" } })).toBeNull();
    const actions = await prisma.action.findMany({ where: { toolName: "delete_monitor" } });
    expect(actions).toHaveLength(1);
  });

  it("resolves an ambiguous delete against two identical-URL monitors by short id, deleting only the targeted one", async () => {
    const m1 = await prisma.monitor.create({ data: { url: "https://httpbin.org/status/200", label: "httpbin.org", intervalSeconds: 60 } });
    const m2 = await prisma.monitor.create({ data: { url: "https://httpbin.org/status/200", label: "httpbin.org", intervalSeconds: 60 } });

    const ambiguous = await deleteMonitor({ identifier: "httpbin" }, ctx);
    expect(ambiguous.kind).toBe("ambiguous");
    expect(await prisma.monitor.count()).toBe(2);

    const result = await deleteMonitor({ identifier: shortId(m2.id) }, ctx);
    expect(result.kind).toBe("ok");

    const remaining = await prisma.monitor.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(m1.id);
  });

  it("returns not_found for an unresolvable identifier without touching the DB", async () => {
    const result = await pauseMonitor({ identifier: "ghost" }, ctx);
    expect(result.kind).toBe("not_found");
  });

  it("rejects createMonitor once the MAX_MONITORS soft cap is reached, without writing an action or calling the SSRF check", async () => {
    const originalMax = process.env.MAX_MONITORS;
    process.env.MAX_MONITORS = "1";
    await prisma.monitor.create({ data: { url: "https://a.com", label: "a", intervalSeconds: 60 } });
    const result = await createMonitor({ url: "https://b.com", intervalSeconds: 60 }, ctx);
    expect(result.message.toLowerCase()).toContain("limit");
    expect(await prisma.monitor.count()).toBe(1);
    expect(await prisma.action.count()).toBe(0);
    expect(ssrf.assertUrlIsSafe).not.toHaveBeenCalled();
    process.env.MAX_MONITORS = originalMax;
  });

  it("falls back to the default cap of 50 when MAX_MONITORS is empty or non-numeric, instead of blocking everything or disabling the cap", async () => {
    const originalMax = process.env.MAX_MONITORS;

    process.env.MAX_MONITORS = "";
    const emptyResult = await createMonitor({ url: "https://c.com", intervalSeconds: 60 }, ctx);
    expect(emptyResult.kind).toBe("ok");
    expect(emptyResult.message.toLowerCase()).not.toContain("limit");

    process.env.MAX_MONITORS = "not-a-number";
    const garbageResult = await createMonitor({ url: "https://d.com", intervalSeconds: 60 }, ctx);
    expect(garbageResult.kind).toBe("ok");
    expect(garbageResult.message.toLowerCase()).not.toContain("limit");

    process.env.MAX_MONITORS = originalMax;
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
