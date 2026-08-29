import { prisma } from "../db/client.js";
import { assertUrlIsSafe } from "../guardrails/ssrf.js";
import { resolveMonitor } from "./resolveMonitor.js";
import type { HandlerResult } from "./readHandlers.js";

export interface ActionContext {
  channelId: string;
  performedBy: string;
}

async function logAction(ctx: ActionContext, toolName: string, args: unknown, result: string): Promise<void> {
  await prisma.action.create({
    data: { channelId: ctx.channelId, performedBy: ctx.performedBy, toolName, argsJson: JSON.stringify(args), result },
  });
}

export function deriveLabelFromUrl(url: string): string {
  return new URL(url).hostname;
}

export async function createMonitor(
  args: { url: string; intervalSeconds: number; expectedStatus?: number; label?: string },
  ctx: ActionContext,
): Promise<HandlerResult> {
  const parsedMax = Number(process.env.MAX_MONITORS ?? "");
  // Number("") is 0 (would block all creation); Number("garbage") is NaN, and
  // `count >= NaN` is always false (would silently disable the cap entirely) —
  // both are the wrong failure direction for a safety guardrail, so fall back to
  // the documented default of 50 for anything that isn't a real finite number.
  const maxMonitors = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 50;
  const existingCount = await prisma.monitor.count();
  if (existingCount >= maxMonitors) {
    return { kind: "ok", message: `Can't create another monitor: you're at the limit of ${maxMonitors}. Delete one first.` };
  }
  await assertUrlIsSafe(args.url);
  const monitor = await prisma.monitor.create({
    data: {
      url: args.url,
      intervalSeconds: args.intervalSeconds,
      expectedStatus: args.expectedStatus ?? 200,
      label: args.label ?? deriveLabelFromUrl(args.url),
    },
  });
  await logAction(ctx, "create_monitor", args, "created");
  return { kind: "ok", message: `Created monitor "${monitor.label}" for ${monitor.url}, checking every ${monitor.intervalSeconds}s.` };
}

async function withResolvedMonitor(
  identifier: string,
  fn: (monitorId: string) => Promise<HandlerResult>,
): Promise<HandlerResult> {
  const resolved = await resolveMonitor(identifier);
  if (resolved.kind === "not_found") return { kind: "not_found", message: `No monitor found matching "${identifier}".` };
  if (resolved.kind === "ambiguous") {
    const list = resolved.candidates.map((c) => `- ${c.url}`).join("\n");
    return { kind: "ambiguous", message: `Multiple monitors match "${identifier}":\n${list}\nWhich one?`, candidates: resolved.candidates };
  }
  return fn(resolved.monitor.id);
}

export async function pauseMonitor(args: { identifier: string }, ctx: ActionContext): Promise<HandlerResult> {
  return withResolvedMonitor(args.identifier, async (id) => {
    const m = await prisma.monitor.update({ where: { id }, data: { enabled: false } });
    await logAction(ctx, "pause_monitor", args, "paused");
    return { kind: "ok", message: `Paused "${m.label}".` };
  });
}

export async function resumeMonitor(args: { identifier: string }, ctx: ActionContext): Promise<HandlerResult> {
  return withResolvedMonitor(args.identifier, async (id) => {
    const m = await prisma.monitor.update({ where: { id }, data: { enabled: true } });
    await logAction(ctx, "resume_monitor", args, "resumed");
    return { kind: "ok", message: `Resumed "${m.label}".` };
  });
}

export async function deleteMonitor(args: { identifier: string }, ctx: ActionContext): Promise<HandlerResult> {
  return withResolvedMonitor(args.identifier, async (id) => {
    const m = await prisma.monitor.delete({ where: { id } });
    await logAction(ctx, "delete_monitor", args, "deleted");
    return { kind: "ok", message: `Deleted "${m.label}".` };
  });
}

export async function editMonitor(
  args: { identifier: string; url?: string; intervalSeconds?: number; expectedStatus?: number; label?: string },
  ctx: ActionContext,
): Promise<HandlerResult> {
  return withResolvedMonitor(args.identifier, async (id) => {
    if (args.url) await assertUrlIsSafe(args.url);
    const { identifier, ...updates } = args;
    const m = await prisma.monitor.update({ where: { id }, data: updates });
    await logAction(ctx, "edit_monitor", args, "edited");
    return { kind: "ok", message: `Updated "${m.label}".` };
  });
}
