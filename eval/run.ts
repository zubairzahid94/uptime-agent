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
  console.log("Running GeminiAdapter evaluation...");

  // Read into a local so the narrowing sticks: GoogleGenAIOptions.apiKey is
  // `string`, and under exactOptionalPropertyTypes passing `string | undefined`
  // is an error. Failing fast here also beats a confusing auth error 9 cases in.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error(
      "GEMINI_API_KEY is not set. Set it in .env or the environment before running the eval.",
    );
    process.exit(1);
  }

  const adapter = new GeminiAdapter(new GoogleGenAI({ apiKey }));
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
    // A MultiTurnCase with fewer than 2 turns is a malformed fixture, not a model
    // failure. Report it as such instead of crashing on an undefined access.
    if (!finalTurn) {
      console.log(`FAIL [multi] ${c.name}`);
      console.log("  malformed case: needs at least one turn");
      fail++;
      continue;
    }
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

// Without this, an API error (bad key, quota, network) surfaces as an unhandled
// rejection and a raw stack trace, which on Windows/Node 24 also trips a libuv abort.
main().catch((err) => {
  console.error("Eval failed. Check GEMINI_API_KEY is set and valid.");
  console.error(err);
  process.exit(1);
});
