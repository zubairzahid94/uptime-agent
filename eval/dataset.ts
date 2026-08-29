import type { ToolName } from "../src/llm/tools.js";

export interface SingleTurnCase {
  kind: "single_turn";
  name: string;
  input: string;
  expectedTool: ToolName;
  expectedArgs: Record<string, unknown>;
}

export interface MultiTurnCase {
  kind: "multi_turn";
  name: string;
  turns: string[]; // all but the last are prior user turns; the last is the message being evaluated
  expectedTool: ToolName;
  expectedArgs: Record<string, unknown>;
}

export const SINGLE_TURN_CASES: SingleTurnCase[] = [
  {
    kind: "single_turn", name: "create with explicit interval and status",
    input: "monitor https://myapp.com every 10 min, alert if not 200",
    expectedTool: "create_monitor",
    expectedArgs: { url: "https://myapp.com", intervalSeconds: 600, expectedStatus: 200 },
  },
  {
    kind: "single_turn", name: "delete by informal name",
    input: "stop the one for hanifautos",
    expectedTool: "delete_monitor",
    expectedArgs: { identifier: "hanifautos" },
  },
  {
    kind: "single_turn", name: "summary count",
    input: "how many monitors are on?",
    expectedTool: "get_summary",
    expectedArgs: {},
  },
  {
    kind: "single_turn", name: "list all",
    input: "show me all my monitors",
    expectedTool: "list_monitors",
    expectedArgs: {},
  },
  {
    kind: "single_turn", name: "pause",
    input: "pause the myapp monitor",
    expectedTool: "pause_monitor",
    expectedArgs: { identifier: "myapp" },
  },
  {
    kind: "single_turn", name: "resume",
    input: "turn the myapp monitor back on",
    expectedTool: "resume_monitor",
    expectedArgs: { identifier: "myapp" },
  },
  {
    kind: "single_turn", name: "edit interval",
    input: "change the myapp monitor to check every 5 minutes",
    expectedTool: "edit_monitor",
    expectedArgs: { identifier: "myapp", intervalSeconds: 300 },
  },
  {
    kind: "single_turn", name: "status check",
    input: "what's the status of myapp?",
    expectedTool: "get_monitor_status",
    expectedArgs: { identifier: "myapp" },
  },
];

export const MULTI_TURN_CASES: MultiTurnCase[] = [
  {
    kind: "multi_turn", name: "disambiguation follow-up resolves to second candidate",
    turns: ["stop the monitor", "the second one"],
    expectedTool: "delete_monitor",
    expectedArgs: {},
  },
];
