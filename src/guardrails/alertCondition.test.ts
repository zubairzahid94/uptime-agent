import { describe, it, expect } from "vitest";
import { evaluateCheckResult } from "./alertCondition.js";

describe("evaluateCheckResult", () => {
  it("first failure from unknown does not alert yet (needs 2 consecutive)", () => {
    const r = evaluateCheckResult({ success: false, priorStatus: "unknown", priorConsecutiveFailures: 0 });
    expect(r.newStatus).toBe("unknown");
    expect(r.newConsecutiveFailures).toBe(1);
    expect(r.shouldAlert).toBe(false);
  });

  it("second consecutive failure transitions to down and alerts", () => {
    const r = evaluateCheckResult({ success: false, priorStatus: "unknown", priorConsecutiveFailures: 1 });
    expect(r.newStatus).toBe("down");
    expect(r.newConsecutiveFailures).toBe(2);
    expect(r.shouldAlert).toBe(true);
    expect(r.causedAlert).toBe(true);
  });

  it("further failures while already down do not re-alert", () => {
    const r = evaluateCheckResult({ success: false, priorStatus: "down", priorConsecutiveFailures: 3 });
    expect(r.newStatus).toBe("down");
    expect(r.shouldAlert).toBe(false);
  });

  it("a single success while down immediately recovers and alerts", () => {
    const r = evaluateCheckResult({ success: true, priorStatus: "down", priorConsecutiveFailures: 2 });
    expect(r.newStatus).toBe("up");
    expect(r.newConsecutiveFailures).toBe(0);
    expect(r.shouldAlert).toBe(true);
  });

  it("success while already up does not alert", () => {
    const r = evaluateCheckResult({ success: true, priorStatus: "up", priorConsecutiveFailures: 0 });
    expect(r.newStatus).toBe("up");
    expect(r.shouldAlert).toBe(false);
  });

  it("first ever success from unknown sets up without alert", () => {
    const r = evaluateCheckResult({ success: true, priorStatus: "unknown", priorConsecutiveFailures: 0 });
    expect(r.newStatus).toBe("up");
    expect(r.shouldAlert).toBe(false);
  });
});
