export type MonitorStatus = "up" | "down" | "unknown";

export interface EvaluateInput {
  success: boolean;
  priorStatus: MonitorStatus;
  priorConsecutiveFailures: number;
}

export interface EvaluateOutput {
  newStatus: MonitorStatus;
  newConsecutiveFailures: number;
  shouldAlert: boolean;
  causedAlert: boolean;
}

const FAILURE_THRESHOLD = 2;

export function evaluateCheckResult(input: EvaluateInput): EvaluateOutput {
  if (input.success) {
    const wasDownOrUnknown = input.priorStatus !== "up";
    return {
      newStatus: "up",
      newConsecutiveFailures: 0,
      shouldAlert: wasDownOrUnknown && input.priorStatus === "down",
      causedAlert: wasDownOrUnknown && input.priorStatus === "down",
    };
  }

  const newConsecutiveFailures = input.priorConsecutiveFailures + 1;
  const crossedThreshold = newConsecutiveFailures >= FAILURE_THRESHOLD && input.priorStatus !== "down";

  return {
    newStatus: crossedThreshold ? "down" : input.priorStatus,
    newConsecutiveFailures,
    shouldAlert: crossedThreshold,
    causedAlert: crossedThreshold,
  };
}
