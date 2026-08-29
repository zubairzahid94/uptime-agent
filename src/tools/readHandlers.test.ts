import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../db/client.js";
import { listMonitors, getMonitorStatus, getSummary } from "./readHandlers.js";

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

  it("getSummary reports the total count", async () => {
    await prisma.monitor.create({ data: { url: "https://a.com", label: "a", intervalSeconds: 60 } });
    await prisma.monitor.create({ data: { url: "https://b.com", label: "b", intervalSeconds: 60, enabled: false } });
    const result = await getSummary();
    expect(result.message).toContain("2");
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
