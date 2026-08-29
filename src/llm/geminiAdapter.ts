import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { TOOLS, type ToolName } from "./tools.js";
import type { LlmAdapter, ChatTurn, AdapterResult } from "./adapter.js";

interface GeminiResponseLike {
  functionCalls?: Array<{ name?: string; args?: Record<string, unknown> }> | undefined;
  text?: string | undefined;
}

export function parseGeminiResponse(response: GeminiResponseLike): AdapterResult {
  const call = response.functionCalls?.[0];
  if (call) {
    if (!call.name) {
      throw new Error("parseGeminiResponse: function call is missing its name");
    }
    return { kind: "tool_call", toolName: call.name as ToolName, args: call.args ?? {} };
  }
  if (typeof response.text === "string") {
    return { kind: "text", text: response.text };
  }
  throw new Error("parseGeminiResponse: response has no function call or text");
}

const SYSTEM_PROMPT = `You are an uptime-monitoring assistant. You have tools to create, list,
edit, pause, resume, and delete HTTP monitors, and to report status/summaries.
If a request is ambiguous (no URL given, or multiple monitors could match), do not guess:
call the relevant read tool or ask a clarifying question listing the candidates instead.`;

export class GeminiAdapter implements LlmAdapter {
  constructor(private client: GoogleGenAI, private model = "gemini-2.0-flash") {}

  async sendMessage(history: ChatTurn[], userMessage: string): Promise<AdapterResult> {
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
      ...history.map((turn) => ({ role: turn.role === "user" ? "user" : "model", parts: [{ text: turn.text }] })),
      { role: "user", parts: [{ text: userMessage }] },
    ];

    const response = await this.client.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [{ functionDeclarations }],
      },
    });

    return parseGeminiResponse(response);
  }
}
