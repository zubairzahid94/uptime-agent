import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../db/client.js";
import * as ssrf from "../guardrails/ssrf.js";
import { createMonitor, editMonitor, pauseMonitor, resumeMonitor, deleteMonitor, deriveLabelFromUrl } from "./mutatingHandlers.js";

const ctx = { channelId: "dm-1", performedBy: "owner-1" };

describe("mutating handlers", () => {
  beforeEach(async () => {
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
    expect(actions[0].toolName).toBe("create_monitor");
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

  it("returns not_found for an unresolvable identifier without touching the DB", async () => {
    const result = await pauseMonitor({ identifier: "ghost" }, ctx);
    expect(result.kind).toBe("not_found");
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
