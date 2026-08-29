import { prisma, type Monitor } from "../db/client.js";
import { safeFetch, SsrfBlockedError } from "../guardrails/ssrf.js";
import { evaluateCheckResult, type MonitorStatus } from "../guardrails/alertCondition.js";

interface TickOptions {
  fetchImpl?: typeof fetch;
  onStateChange?: (monitor: Monitor, newStatus: MonitorStatus) => void;
}

export async function runSchedulerTick(opts: TickOptions = {}): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = new Date();

  const dueMonitors = await prisma.monitor.findMany({ where: { enabled: true } });
  const due = dueMonitors.filter((m) => {
    if (!m.lastCheckedAt) return true;
    const dueAt = m.lastCheckedAt.getTime() + m.intervalSeconds * 1000;
    return dueAt <= now.getTime();
  });

  for (const monitor of due) {
    const startedAt = Date.now();
    let success = false;
    let statusCode: number | undefined;
    let error: string | undefined;

    try {
      const res = await safeFetch(monitor.url, fetchImpl);
      statusCode = res.status;
      success = res.status === monitor.expectedStatus;
    } catch (e) {
      error = e instanceof SsrfBlockedError ? e.message : e instanceof Error ? e.message : String(e);
      success = false;
    }

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
      opts.onStateChange?.(monitor, evalResult.newStatus);
    }
  }
}
