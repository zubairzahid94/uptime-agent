import { z } from "zod";

export type ToolName =
  | "create_monitor" | "list_monitors" | "get_monitor_status" | "pause_monitor"
  | "resume_monitor" | "delete_monitor" | "edit_monitor" | "get_summary";

export interface ToolDefinition<T = any> {
  name: ToolName;
  description: string;
  schema: z.ZodType<T>;
  mutating: boolean;
}

const identifierSchema = z.object({
  identifier: z.string().min(1).describe("URL, label, or partial match identifying the monitor"),
});

export const TOOLS: Record<ToolName, ToolDefinition> = {
  create_monitor: {
    name: "create_monitor",
    description: "Create a new HTTP monitor",
    mutating: true,
    schema: z.object({
      url: z.string().url(),
      intervalSeconds: z.number().int().min(60, "interval must be at least 60 seconds"),
      expectedStatus: z.number().int().default(200),
      label: z.string().min(1).optional(),
    }),
  },
  list_monitors: {
    name: "list_monitors",
    description: "List all monitors",
    mutating: false,
    schema: z.object({}),
  },
  get_monitor_status: {
    name: "get_monitor_status",
    description: "Get the current status of one monitor",
    mutating: false,
    schema: identifierSchema,
  },
  pause_monitor: {
    name: "pause_monitor",
    description: "Pause a monitor so it stops being polled",
    mutating: true,
    schema: identifierSchema,
  },
  resume_monitor: {
    name: "resume_monitor",
    description: "Resume a paused monitor",
    mutating: true,
    schema: identifierSchema,
  },
  delete_monitor: {
    name: "delete_monitor",
    description: "Permanently delete a monitor",
    mutating: true,
    schema: identifierSchema,
  },
  edit_monitor: {
    name: "edit_monitor",
    description: "Change a monitor's interval, expected status, url, or label",
    mutating: true,
    schema: z.object({
      identifier: z.string().min(1),
      url: z.string().url().optional(),
      intervalSeconds: z.number().int().min(60).optional(),
      expectedStatus: z.number().int().optional(),
      label: z.string().min(1).optional(),
    }),
  },
  get_summary: {
    name: "get_summary",
    description: "Get a count/overview of all monitors",
    mutating: false,
    schema: z.object({}),
  },
};
