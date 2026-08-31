import { prisma, type Monitor, type Check } from "../db/client.js";
import { resolveMonitor, shortId } from "./resolveMonitor.js";
import { formatRelativeTime } from "../bot/templates.js";

const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 25;
const MAX_ERROR_LENGTH = 80;

export type HandlerResult =
  | { kind: "ok"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "ambiguous"; message: string; candidates: Monitor[] };

function formatMonitorLine(m: Monitor): string {
  return `- ${m.label} (${m.url}): ${m.healthStatus}, ${m.enabled ? "enabled" : "paused"}, every ${m.intervalSeconds}s`;
}

export async function listMonitors(): Promise<HandlerResult> {
  const monitors = await prisma.monitor.findMany({ orderBy: { createdAt: "asc" } });
  if (monitors.length === 0) return { kind: "ok", message: "No monitors yet." };
  return { kind: "ok", message: monitors.map(formatMonitorLine).join("\n") };
}

export async function getMonitorStatus(args: { identifier: string }): Promise<HandlerResult> {
  const result = await resolveMonitor(args.identifier);
  if (result.kind === "not_found") {
    return { kind: "not_found", message: `No monitor found matching "${args.identifier}".` };
  }
  if (result.kind === "ambiguous") {
    const list = result.candidates.map((c) => `- ${c.url} (id: ${shortId(c.id)})`).join("\n");
    return { kind: "ambiguous", message: `Multiple monitors match "${args.identifier}":\n${list}\nWhich one? Reply with its id, e.g. "${shortId(result.candidates[0]!.id)}".`, candidates: result.candidates };
  }
  return { kind: "ok", message: formatMonitorLine(result.monitor) };
}

export async function getSummary(): Promise<HandlerResult> {
  const total = await prisma.monitor.count();
  const active = await prisma.monitor.count({ where: { enabled: true } });
  const down = await prisma.monitor.count({ where: { healthStatus: "down" } });
  return { kind: "ok", message: `${total} monitor(s) total: ${active} active, ${total - active} paused, ${down} currently down.` };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatCheckLine(check: Check): string {
  const icon = check.success ? "✅" : "❌";
  const detail = check.error ? truncate(check.error, MAX_ERROR_LENGTH) : String(check.statusCode ?? "unknown");
  const alertMarker = check.causedAlert ? "🔔 " : "";
  const latency = check.latencyMs != null ? `, ${check.latencyMs}ms` : "";
  return `- ${formatRelativeTime(check.timestamp)}: ${alertMarker}${icon} ${detail}${latency}`;
}

export async function getMonitorHistory(args: { identifier: string; limit?: number }): Promise<HandlerResult> {
  const result = await resolveMonitor(args.identifier);
  if (result.kind === "not_found") {
    return { kind: "not_found", message: `No monitor found matching "${args.identifier}".` };
  }
  if (result.kind === "ambiguous") {
    const list = result.candidates.map((c) => `- ${c.url} (id: ${shortId(c.id)})`).join("\n");
    return { kind: "ambiguous", message: `Multiple monitors match "${args.identifier}":\n${list}\nWhich one? Reply with its id, e.g. "${shortId(result.candidates[0]!.id)}".`, candidates: result.candidates };
  }

  const monitor = result.monitor;
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT);
  const checks = await prisma.check.findMany({
    where: { monitorId: monitor.id },
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  if (checks.length === 0) {
    return { kind: "ok", message: `${monitor.label} (${monitor.url}) hasn't been checked yet — first check runs within ${monitor.intervalSeconds}s.` };
  }

  const lines = checks.map(formatCheckLine).join("\n");
  return { kind: "ok", message: `History for ${monitor.label} (${monitor.url}):\n${lines}` };
}
