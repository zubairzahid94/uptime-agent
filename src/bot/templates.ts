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

export function renderAlertMessage(monitor: Pick<Monitor, "label" | "url">, newStatus: MonitorStatus): string {
  if (newStatus === "down") {
    return `🔴 ${monitor.label} (${monitor.url}) is DOWN.`;
  }
  return `🟢 ${monitor.label} (${monitor.url}) is back UP.`;
}
