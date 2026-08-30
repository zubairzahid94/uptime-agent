import { prisma, type Monitor } from "../db/client.js";
import { safeFetch, SsrfBlockedError, drainBody } from "../guardrails/ssrf.js";
import { evaluateCheckResult, type MonitorStatus } from "../guardrails/alertCondition.js";
import { logger } from "../logger.js";

interface TickOptions {
  fetchImpl?: typeof fetch;
  onStateChange?: (monitor: Monitor, newStatus: MonitorStatus) => void;
  /** Per-monitor request timeout. Defaults to 10s. */
  timeoutMs?: number;
}

/**
 * A stalled connection must not be able to hold a tick open indefinitely: undici's
 * default header timeout is very long, and while a tick is stuck every subsequent
 * tick sees the same monitor as still due (lastCheckedAt only advances after the
 * fetch resolves), risking duplicate Check rows and duplicate alerts.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

export async function runSchedulerTick(opts: TickOptions = {}): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tickStartedAt = Date.now();
  const now = new Date();

  const dueMonitors = await prisma.monitor.findMany({ where: { enabled: true } });
  const due = dueMonitors.filter((m) => {
    if (!m.lastCheckedAt) return true;
    const dueAt = m.lastCheckedAt.getTime() + m.intervalSeconds * 1000;
    return dueAt <= now.getTime();
  });

  let failures = 0;
  let alerts = 0;

  for (const monitor of due) {
    const startedAt = Date.now();
    let success = false;
    let statusCode: number | undefined;
    let error: string | undefined;

    try {
      const res = await safeFetch(monitor.url, fetchImpl, 5, { signal: AbortSignal.timeout(timeoutMs) });
      statusCode = res.status;
      success = res.status === monitor.expectedStatus;
      // We only ever need the status line; an unread body holds its socket open.
      drainBody(res);
    } catch (e) {
      error = e instanceof SsrfBlockedError ? e.message : e instanceof Error ? e.message : String(e);
      success = false;
    }

    if (!success) failures++;

    const latencyMs = Date.now() - startedAt;
    const evalResult = evaluateCheckResult({
      success,
      priorStatus: monitor.healthStatus as MonitorStatus,
      priorConsecutiveFailures: monitor.consecutiveFailures,
    });

    await prisma.check.create({
      data: {
        monitorId: monitor.id,
        success,
        statusCode: statusCode ?? null,
        latencyMs,
        error: error ?? null,
        causedAlert: evalResult.causedAlert,
      },
    });

    await prisma.monitor.update({
      where: { id: monitor.id },
      data: {
        healthStatus: evalResult.newStatus,
        consecutiveFailures: evalResult.newConsecutiveFailures,
        lastCheckedAt: now,
        ...(evalResult.causedAlert ? { lastStateChangeAt: now } : {}),
      },
    });

    if (evalResult.shouldAlert) {
      alerts++;
      opts.onStateChange?.(monitor, evalResult.newStatus);
    }
  }

  logger.info("scheduler.tick", {
    enabledMonitors: dueMonitors.length,
    due: due.length,
    failures,
    alerts,
    durationMs: Date.now() - tickStartedAt,
  });
}
