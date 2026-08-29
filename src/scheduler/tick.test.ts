import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../db/client.js";
import { runSchedulerTick } from "./tick.js";

describe("runSchedulerTick", () => {
  beforeEach(async () => {
    await prisma.check.deleteMany();
    await prisma.monitor.deleteMany();
  });

  it("polls a due monitor, records a check, and calls onStateChange on down transition", async () => {
    const monitor = await prisma.monitor.create({
      data: {
        url: "https://example.com",
        label: "example",
        intervalSeconds: 60,
        enabled: true,
        healthStatus: "up",
        consecutiveFailures: 1,
        lastCheckedAt: new Date(Date.now() - 120_000),
      },
    });

    const fetchImpl = vi.fn().mockResolvedValue({ status: 500, headers: new Headers() });
    const onStateChange = vi.fn();

    await runSchedulerTick({ fetchImpl: fetchImpl as any, onStateChange });

    const updated = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(updated.healthStatus).toBe("down");
    expect(updated.consecutiveFailures).toBe(2);
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ id: monitor.id }), "down");

    const checks = await prisma.check.findMany({ where: { monitorId: monitor.id } });
    expect(checks).toHaveLength(1);
    expect(checks[0]!.success).toBe(false);
    expect(checks[0]!.causedAlert).toBe(true);
  });

  it("skips monitors that are not yet due", async () => {
    const monitor = await prisma.monitor.create({
      data: {
        url: "https://example.com",
        label: "example",
        intervalSeconds: 3600,
        enabled: true,
        lastCheckedAt: new Date(),
      },
    });
    const fetchImpl = vi.fn();
    await runSchedulerTick({ fetchImpl: fetchImpl as any });
    expect(fetchImpl).not.toHaveBeenCalled();
    await prisma.monitor.delete({ where: { id: monitor.id } });
  });

  it("skips paused (disabled) monitors", async () => {
    const monitor = await prisma.monitor.create({
      data: { url: "https://example.com", label: "example", intervalSeconds: 60, enabled: false },
    });
    const fetchImpl = vi.fn();
    await runSchedulerTick({ fetchImpl: fetchImpl as any });
    expect(fetchImpl).not.toHaveBeenCalled();
    await prisma.monitor.delete({ where: { id: monitor.id } });
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
