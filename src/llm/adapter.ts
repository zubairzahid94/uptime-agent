import type { ToolName } from "./tools.js";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export type AdapterResult =
  | { kind: "tool_call"; toolName: ToolName; args: unknown }
  | { kind: "text"; text: string };

export interface LlmAdapter {
  sendMessage(history: ChatTurn[], userMessage: string): Promise<AdapterResult>;
}
