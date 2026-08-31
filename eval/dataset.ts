import type { ToolName } from "../src/llm/tools.js";
import type { ChatTurn } from "../src/llm/adapter.js";

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
  // All but the last are prior conversation turns (role-tagged, so an assistant
  // clarifying question can actually appear in history); the last must be a user
  // turn and is the message being evaluated.
  turns: ChatTurn[];
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
    input: "permanently delete the hanifautos monitor",
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
  {
    kind: "single_turn", name: "history default count",
    input: "show me the history for myapp",
    expectedTool: "get_monitor_history",
    expectedArgs: { identifier: "myapp" },
  },
  {
    kind: "single_turn", name: "history explicit count",
    input: "show me the last 20 checks for myapp",
    expectedTool: "get_monitor_history",
    expectedArgs: { identifier: "myapp", limit: 20 },
  },
];

export const MULTI_TURN_CASES: MultiTurnCase[] = [
  {
    kind: "multi_turn", name: "disambiguation follow-up resolves to second candidate",
    // The assistant turn matters here: without it the model has no candidate list to
    // resolve "the second one" against, and reasonably falls back to a read tool.
    turns: [
      { role: "user", text: "delete the monitor for hanifautos" },
      {
        role: "assistant",
        text: "Multiple monitors match \"hanifautos\":\n- https://hanifautos.com/a\n- https://hanifautos.com/b\nWhich one?",
      },
      { role: "user", text: "the second one" },
    ],
    expectedTool: "delete_monitor",
    expectedArgs: {},
  },
];
