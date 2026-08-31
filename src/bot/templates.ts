import type { ToolName } from "../llm/tools.js";
import type { Monitor } from "../db/client.js";
import type { MonitorStatus } from "../guardrails/alertCondition.js";

const CONFIRM_SUFFIX = "Reply 'yes' to confirm, or anything else to cancel.";

export function renderConfirmationPrompt(toolName: ToolName, args: any): string {
  switch (toolName) {
    case "create_monitor":
      return `This will create a monitor for ${args.url}, checking every ${args.intervalSeconds}s, alerting if status isn't ${args.expectedStatus ?? 200}. ${CONFIRM_SUFFIX}`;
    case "edit_monitor":
      return `This will update monitor "${args.identifier}" (${Object.keys(args).filter((k) => k !== "identifier").join(", ")}). ${CONFIRM_SUFFIX}`;
    case "pause_monitor":
      return `This will pause monitor "${args.identifier}". ${CONFIRM_SUFFIX}`;
    case "resume_monitor":
      return `This will resume monitor "${args.identifier}". ${CONFIRM_SUFFIX}`;
    case "delete_monitor":
      return `This will permanently delete monitor "${args.identifier}". ${CONFIRM_SUFFIX}`;
    default:
      throw new Error(`renderConfirmationPrompt: ${toolName} is not a mutating tool`);
  }
}

/** Discord rejects any message over 2000 characters; 1900 leaves headroom. */
export const DISCORD_MESSAGE_LIMIT = 1900;

/**
 * Splits a reply into Discord-sized chunks, preferring line boundaries so a
 * monitor list is never cut mid-entry. A single line longer than the limit
 * (a very long URL) is hard-split as a last resort. Never truncates.
 */
export function chunkMessage(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current !== "") {
      chunks.push(current);
      current = "";
    }
  };

  for (const line of text.split("\n")) {
    if (line.length > limit) {
      flush();
      for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
      continue;
    }
    if (current === "") current = line;
    else if (current.length + 1 + line.length <= limit) current += `\n${line}`;
    else {
      flush();
      current = line;
    }
  }
  flush();

  return chunks.length > 0 ? chunks : [text];
}

export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function renderAlertMessage(monitor: Pick<Monitor, "label" | "url">, newStatus: MonitorStatus): string {
  if (newStatus === "down") {
    return `🔴 ${monitor.label} (${monitor.url}) is DOWN.`;
  }
  return `🟢 ${monitor.label} (${monitor.url}) is back UP.`;
}
