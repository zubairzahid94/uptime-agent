import { describe, it, expect } from "vitest";
import { renderConfirmationPrompt, renderAlertMessage, chunkMessage, formatRelativeTime, DISCORD_MESSAGE_LIMIT } from "./templates.js";

describe("formatRelativeTime", () => {
  const now = new Date("2026-08-31T12:00:00Z");

  it("renders seconds for under a minute", () => {
    expect(formatRelativeTime(new Date("2026-08-31T11:59:30Z"), now)).toBe("30s ago");
  });

  it("renders minutes for under an hour", () => {
    expect(formatRelativeTime(new Date("2026-08-31T11:55:00Z"), now)).toBe("5m ago");
  });

  it("renders hours for under a day", () => {
    expect(formatRelativeTime(new Date("2026-08-31T09:00:00Z"), now)).toBe("3h ago");
  });

  it("renders days at a day or more", () => {
    expect(formatRelativeTime(new Date("2026-08-29T12:00:00Z"), now)).toBe("2d ago");
  });
});

describe("chunkMessage", () => {
  it("leaves a short message as a single chunk", () => {
    expect(chunkMessage("hello")).toEqual(["hello"]);
  });

  it("splits a long monitor list on line boundaries without losing or truncating any line", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `- monitor-${i} (https://example-${i}.com): up, enabled, every 60s`);
    const text = lines.join("\n");
    expect(text.length).toBeGreaterThan(2000); // the real listMonitors failure case

    const chunks = chunkMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
    // every original line survives intact, in order
    expect(chunks.join("\n").split("\n")).toEqual(lines);
  });

  it("hard-splits a single line that is itself longer than the limit", () => {
    const chunks = chunkMessage("x".repeat(4500));
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
    expect(chunks.join("")).toBe("x".repeat(4500));
  });
});

describe("renderConfirmationPrompt", () => {
  it("renders create_monitor deterministically from args", () => {
    const msg = renderConfirmationPrompt("create_monitor", { url: "https://a.com", intervalSeconds: 60, expectedStatus: 200 });
    expect(msg).toContain("https://a.com");
    expect(msg).toContain("60");
    expect(msg.toLowerCase()).toContain("reply");
  });

  it("renders delete_monitor with the identifier", () => {
    const msg = renderConfirmationPrompt("delete_monitor", { identifier: "hanifautos" });
    expect(msg).toContain("hanifautos");
    expect(msg.toLowerCase()).toContain("delete");
  });
});

describe("renderAlertMessage", () => {
  it("renders a down alert", () => {
    const msg = renderAlertMessage({ label: "prod-api", url: "https://a.com" } as any, "down");
    expect(msg).toContain("prod-api");
    expect(msg.toUpperCase()).toContain("DOWN");
  });

  it("renders an up/recovery alert", () => {
    const msg = renderAlertMessage({ label: "prod-api", url: "https://a.com" } as any, "up");
    expect(msg.toUpperCase()).toContain("UP");
  });
});
