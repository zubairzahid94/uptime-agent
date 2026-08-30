import winston from "winston";

/**
 * Structured stdout logging for a self-hosted single-process bot.
 *
 * Deliberately minimal: one JSON-per-line Console transport, no files, no
 * rotation, no transports to configure — a container runtime or systemd unit
 * collects stdout. Level is `info` by default, overridable with LOG_LEVEL.
 *
 * Never log message content, tool args, URLs' query strings, or API keys —
 * only shapes, counts, kinds, and timings.
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});
