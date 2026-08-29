import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../db/client.js";
import { resolveMonitor } from "./resolveMonitor.js";

describe("resolveMonitor", () => {
  beforeEach(async () => {
    await prisma.check.deleteMany();
    await prisma.monitor.deleteMany();
  });

  it("finds a unique match by label", async () => {
    const m = await prisma.monitor.create({ data: { url: "https://hanifautos.com", label: "hanifautos", intervalSeconds: 60 } });
    const result = await resolveMonitor("hanifautos");
    expect(result).toEqual({ kind: "found", monitor: expect.objectContaining({ id: m.id }) });
  });

  it("finds a unique match by url substring when no label matches", async () => {
    const m = await prisma.monitor.create({ data: { url: "https://myapp.com/health", label: "myapp", intervalSeconds: 60 } });
    const result = await resolveMonitor("myapp.com");
    expect(result).toEqual({ kind: "found", monitor: expect.objectContaining({ id: m.id }) });
  });

  it("returns not_found when nothing matches", async () => {
    const result = await resolveMonitor("doesnotexist");
    expect(result).toEqual({ kind: "not_found" });
  });

  it("returns ambiguous with candidates when multiple monitors match", async () => {
    await prisma.monitor.create({ data: { url: "https://hanifautos.com/a", label: "hanifautos-a", intervalSeconds: 60 } });
    await prisma.monitor.create({ data: { url: "https://hanifautos.com/b", label: "hanifautos-b", intervalSeconds: 60 } });
    const result = await resolveMonitor("hanifautos");
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") expect(result.candidates).toHaveLength(2);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
