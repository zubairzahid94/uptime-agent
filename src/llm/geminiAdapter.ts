import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { TOOLS, type ToolName } from "./tools.js";
import type { LlmAdapter, ChatTurn, AdapterResult } from "./adapter.js";
import { logger } from "../logger.js";

interface GeminiResponseLike {
  functionCalls?:
    | Array<{ name?: string; args?: Record<string, unknown> }>
    | undefined;
  text?: string | undefined;
}

export function parseGeminiResponse(
  response: GeminiResponseLike,
): AdapterResult {
  const call = response.functionCalls?.[0];
  if (call) {
    if (!call.name) {
      throw new Error("parseGeminiResponse: function call is missing its name");
    }
    return {
      kind: "tool_call",
      toolName: call.name as ToolName,
      args: call.args ?? {},
    };
  }
  if (typeof response.text === "string") {
    return { kind: "text", text: response.text };
  }
  throw new Error("parseGeminiResponse: response has no function call or text");
}

const SYSTEM_PROMPT = `You are an uptime-monitoring assistant. You have tools to create, list,
edit, pause, resume, and delete HTTP monitors, and to report status/summaries.

pause_monitor stops checks temporarily (reversible); resume_monitor turns checks back on;
delete_monitor permanently removes a monitor. Treat "stop", "turn off", or "disable" as
pause_monitor; "turn back on" or "reactivate" as resume_monitor; "delete", "remove", or
"get rid of" as delete_monitor. Map the verb directly to its tool; do not second-guess
which action was meant just because a synonym isn't the exact tool name.

When a user names a monitor by label or URL fragment (e.g. "myapp", "hanifautos"), call
the mutating tool directly with that text as the identifier. Do not call a read tool
first to check whether it exists — identifier resolution, ambiguity, and confirmation
are all handled after your tool call and before anything actually executes. You never
need to pre-verify a monitor exists before acting on it by name.

The only thing you must never guess is WHICH monitor a request refers to when the
request itself gives you nothing to go on at all (no name, no URL, no prior context).
In that case, ask a clarifying question instead of picking a tool — but a name or URL
fragment, even a partial or possibly-nonexistent one, is enough to call the tool.`;

export class GeminiAdapter implements LlmAdapter {
  constructor(
    private client: GoogleGenAI,
    private model = "gemini-3.5-flash-lite",
  ) {}

  async sendMessage(
    history: ChatTurn[],
    userMessage: string,
  ): Promise<AdapterResult> {
    const functionDeclarations = Object.values(TOOLS).map((tool) => ({
      name: tool.name,
      description: tool.description,
      // parametersJsonSchema (not `parameters`) is the field that accepts standard JSON
      // Schema; `parameters` expects Google's own Type-enum-based Schema format instead,
      // and the two are mutually exclusive.
      //
      // Deviation from the task brief: the brief specified the third-party
      // `zod-to-json-schema` package, but that package (v3.25.2, installed) does not
      // support Zod v4 schemas at runtime; it silently returns `{}` for every schema in
      // TOOLS (verified directly against the installed packages). Its own README confirms
      // this and recommends Zod v4's native `z.toJSONSchema()` instead, which is what this
      // uses; it produces correct, complete JSON Schema for every schema in TOOLS.
      parametersJsonSchema: z.toJSONSchema(tool.schema),
    }));

    const contents = [
      ...history.map((turn) => ({
        role: turn.role === "user" ? "user" : "model",
        parts: [{ text: turn.text }],
      })),
      { role: "user", parts: [{ text: userMessage }] },
    ];

    const startedAt = Date.now();
    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: [{ functionDeclarations }],
        },
      });
    } catch (err) {
      logger.error("llm.sendMessage failed", {
        model: this.model,
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const result = parseGeminiResponse(response);
    // Shape only, never content: no message text, no tool args, no API key.
    logger.info("llm.sendMessage", {
      model: this.model,
      historyTurns: history.length,
      latencyMs: Date.now() - startedAt,
      resultKind: result.kind,
      ...(result.kind === "tool_call" ? { toolName: result.toolName } : {}),
    });
    return result;
  }
}
