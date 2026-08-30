import { prisma, type Monitor } from "../db/client.js";

export type ResolveResult =
  | { kind: "found"; monitor: Monitor }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidates: Monitor[] };

const SHORT_ID_LENGTH = 6;

export function shortId(id: string): string {
  return id.slice(-SHORT_ID_LENGTH);
}

export async function resolveMonitor(identifier: string): Promise<ResolveResult> {
  const needle = identifier.toLowerCase();

  if (needle.length >= SHORT_ID_LENGTH) {
    const byId = await prisma.monitor.findMany({ where: { id: { endsWith: needle } } });
    if (byId.length === 1) return { kind: "found", monitor: byId[0]! };
  }

  const byLabel = await prisma.monitor.findMany({ where: { label: { contains: needle } } });
  const matches = byLabel.length > 0
    ? byLabel
    : await prisma.monitor.findMany({ where: { url: { contains: needle } } });

  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length === 1) return { kind: "found", monitor: matches[0]! };
  return { kind: "ambiguous", candidates: matches };
}
