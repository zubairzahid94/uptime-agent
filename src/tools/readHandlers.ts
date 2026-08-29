import { prisma, type Monitor } from "../db/client.js";
import { resolveMonitor } from "./resolveMonitor.js";

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
    const list = result.candidates.map((c) => `- ${c.url}`).join("\n");
    return { kind: "ambiguous", message: `Multiple monitors match "${args.identifier}":\n${list}\nWhich one?`, candidates: result.candidates };
  }
  return { kind: "ok", message: formatMonitorLine(result.monitor) };
}

export async function getSummary(): Promise<HandlerResult> {
  const total = await prisma.monitor.count();
  const active = await prisma.monitor.count({ where: { enabled: true } });
  const down = await prisma.monitor.count({ where: { healthStatus: "down" } });
  return { kind: "ok", message: `${total} monitor(s) total: ${active} active, ${total - active} paused, ${down} currently down.` };
}
