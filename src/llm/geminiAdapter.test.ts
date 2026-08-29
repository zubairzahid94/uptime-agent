import { describe, it, expect } from "vitest";
import { parseGeminiResponse } from "./geminiAdapter.js";

describe("parseGeminiResponse", () => {
  it("normalizes a function-call response into a tool_call result", () => {
    const response = {
      functionCalls: [{ name: "create_monitor", args: { url: "https://a.com", intervalSeconds: 60 } }],
      text: undefined,
    };
    const result = parseGeminiResponse(response);
    expect(result).toEqual({ kind: "tool_call", toolName: "create_monitor", args: { url: "https://a.com", intervalSeconds: 60 } });
  });

  it("normalizes a plain-text response into a text result", () => {
    const response = { functionCalls: undefined, text: "Which monitor did you mean?" };
    const result = parseGeminiResponse(response);
    expect(result).toEqual({ kind: "text", text: "Which monitor did you mean?" });
  });

  it("uses the first function call when the model returns more than one", () => {
    const response = {
      functionCalls: [
        { name: "list_monitors", args: {} },
        { name: "get_summary", args: {} },
      ],
      text: undefined,
    };
    const result = parseGeminiResponse(response);
    expect(result).toEqual({ kind: "tool_call", toolName: "list_monitors", args: {} });
  });

  it("throws a clear error when a function call is missing its name", () => {
    const response = { functionCalls: [{ args: {} }], text: undefined };
    expect(() => parseGeminiResponse(response)).toThrow(/missing.*name/i);
  });

  it("throws a clear error on a response with neither a function call nor text", () => {
    expect(() => parseGeminiResponse({ functionCalls: undefined, text: undefined })).toThrow(/no function call or text/i);
  });
});
