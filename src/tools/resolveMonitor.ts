import { prisma, type Monitor } from "../db/client.js";

export type ResolveResult =
  | { kind: "found"; monitor: Monitor }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidates: Monitor[] };

export async function resolveMonitor(identifier: string): Promise<ResolveResult> {
  const needle = identifier.toLowerCase();

  const byLabel = await prisma.monitor.findMany({ where: { label: { contains: needle } } });
  const matches = byLabel.length > 0
    ? byLabel
    : await prisma.monitor.findMany({ where: { url: { contains: needle } } });

  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length === 1) return { kind: "found", monitor: matches[0] };
  return { kind: "ambiguous", candidates: matches };
}
