import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { GeminiAdapter } from "../src/llm/geminiAdapter.js";
import { SINGLE_TURN_CASES, MULTI_TURN_CASES } from "./dataset.js";
import type { ChatTurn } from "../src/llm/adapter.js";

function argsMatch(
  actual: unknown,
  expected: Record<string, unknown>,
): boolean {
  if (typeof actual !== "object" || actual === null) return false;
  return Object.entries(expected).every(
    ([key, value]) => (actual as any)[key] === value,
  );
}

async function main() {
  console.log(
    "Running GeminiAdapter evaluation...",
    process.env.GEMINI_API_KEY ? "" : "(GEMINI_API_KEY not set; will fail)",
  );
  const adapter = new GeminiAdapter(
    new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }),
  );
  let pass = 0;
  let fail = 0;

  for (const c of SINGLE_TURN_CASES) {
    const result = await adapter.sendMessage([], c.input);
    const ok =
      result.kind === "tool_call" &&
      result.toolName === c.expectedTool &&
      argsMatch(result.args, c.expectedArgs);
    console.log(`${ok ? "PASS" : "FAIL"} [single] ${c.name}`);
    if (!ok)
      console.log(
        `  expected ${c.expectedTool} ${JSON.stringify(c.expectedArgs)}, got`,
        result,
      );
    ok ? pass++ : fail++;
  }

  for (const c of MULTI_TURN_CASES) {
    const history: ChatTurn[] = c.turns.slice(0, -1);
    const finalTurn = c.turns[c.turns.length - 1];
    const result = await adapter.sendMessage(history, finalTurn.text);
    const ok =
      result.kind === "tool_call" &&
      result.toolName === c.expectedTool &&
      argsMatch(result.args, c.expectedArgs);
    console.log(`${ok ? "PASS" : "FAIL"} [multi] ${c.name}`);
    if (!ok)
      console.log(
        `  expected ${c.expectedTool} ${JSON.stringify(c.expectedArgs)}, got`,
        result,
      );
    ok ? pass++ : fail++;
  }

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
