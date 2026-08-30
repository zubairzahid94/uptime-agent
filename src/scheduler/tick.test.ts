import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import dns from "node:dns/promises";
import { prisma } from "../db/client.js";
import { runSchedulerTick } from "./tick.js";

describe("runSchedulerTick", () => {
  beforeEach(async () => {
    await prisma.check.deleteMany();
    await prisma.monitor.deleteMany();
    // Keep this suite deterministic and offline: without a dns.lookup mock the SSRF
    // guardrail makes a real network call for every polled monitor, which both makes
    // the suite network-dependent and can mask guardrail bugs (a blocked URL and a
    // genuine failing response both surface as success:false).
    vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("records a successful check when the response status matches expectedStatus", async () => {
    const monitor = await prisma.monitor.create({
      data: {
        url: "https://example.com",
        label: "example",
        intervalSeconds: 60,
        expectedStatus: 200,
        enabled: true,
        healthStatus: "up",
        consecutiveFailures: 0,
        lastCheckedAt: new Date(Date.now() - 120_000),
      },
    });

    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, headers: new Headers() });
    const onStateChange = vi.fn();

    await runSchedulerTick({ fetchImpl: fetchImpl as any, onStateChange });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const updated = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(updated.healthStatus).toBe("up");
    expect(updated.consecutiveFailures).toBe(0);
    expect(updated.lastCheckedAt).not.toBeNull();
    expect(onStateChange).not.toHaveBeenCalled();

    const checks = await prisma.check.findMany({ where: { monitorId: monitor.id } });
    expect(checks).toHaveLength(1);
    expect(checks[0]!.success).toBe(true);
    expect(checks[0]!.statusCode).toBe(200);
    expect(checks[0]!.error).toBeNull();
    expect(checks[0]!.causedAlert).toBe(false);
  });

  it("treats a non-matching status as a failed check even though the request succeeded", async () => {
    const monitor = await prisma.monitor.create({
      data: {
        url: "https://example.com",
        label: "example",
        intervalSeconds: 60,
        expectedStatus: 204,
        enabled: true,
        healthStatus: "up",
        consecutiveFailures: 0,
      },
    });

    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, headers: new Headers() });
    await runSchedulerTick({ fetchImpl: fetchImpl as any });

    const checks = await prisma.check.findMany({ where: { monitorId: monitor.id } });
    expect(checks[0]!.success).toBe(false);
    expect(checks[0]!.statusCode).toBe(200);
  });

  it("alerts on a down->up recovery transition", async () => {
    const monitor = await prisma.monitor.create({
      data: {
        url: "https://example.com",
        label: "example",
        intervalSeconds: 60,
        expectedStatus: 200,
        enabled: true,
        healthStatus: "down",
        consecutiveFailures: 3,
        lastCheckedAt: new Date(Date.now() - 120_000),
      },
    });

    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, headers: new Headers() });
    const onStateChange = vi.fn();

    await runSchedulerTick({ fetchImpl: fetchImpl as any, onStateChange });

    const updated = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(updated.healthStatus).toBe("up");
    expect(updated.consecutiveFailures).toBe(0);
    expect(updated.lastStateChangeAt).not.toBeNull();
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ id: monitor.id }), "up");

    const checks = await prisma.check.findMany({ where: { monitorId: monitor.id } });
    expect(checks[0]!.success).toBe(true);
    expect(checks[0]!.causedAlert).toBe(true);
  });

  it("records a failed check with an error when the URL is blocked by the SSRF guardrail", async () => {
    const monitor = await prisma.monitor.create({
      data: {
        url: "http://169.254.169.254/latest/meta-data",
        label: "metadata",
        intervalSeconds: 60,
        enabled: true,
        healthStatus: "up",
        consecutiveFailures: 0,
      },
    });

    const fetchImpl = vi.fn();
    await runSchedulerTick({ fetchImpl: fetchImpl as any });

    expect(fetchImpl).not.toHaveBeenCalled();
    const checks = await prisma.check.findMany({ where: { monitorId: monitor.id } });
    expect(checks).toHaveLength(1);
    expect(checks[0]!.success).toBe(false);
    expect(checks[0]!.error).toContain("Blocked unsafe URL");
    expect(checks[0]!.statusCode).toBeNull();
  });

  it("passes an abort signal to fetch so a stalled connection can't hold the tick open", async () => {
    await prisma.monitor.create({
      data: { url: "https://example.com", label: "example", intervalSeconds: 60, enabled: true },
    });

    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, headers: new Headers() });
    await runSchedulerTick({ fetchImpl: fetchImpl as any, timeoutMs: 5_000 });

    const init = fetchImpl.mock.calls[0]![1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
    expect(init.redirect).toBe("manual"); // per-hop revalidation must stay intact
  });

  it("records a failed check when the request times out", async () => {
    const monitor = await prisma.monitor.create({
      data: { url: "https://example.com", label: "example", intervalSeconds: 60, enabled: true, healthStatus: "up" },
    });

    const fetchImpl = vi.fn().mockRejectedValue(
      Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
    );
    await runSchedulerTick({ fetchImpl: fetchImpl as any, timeoutMs: 10 });

    const checks = await prisma.check.findMany({ where: { monitorId: monitor.id } });
    expect(checks).toHaveLength(1);
    expect(checks[0]!.success).toBe(false);
    expect(checks[0]!.error).toContain("aborted");
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
