import { describe, it, expect } from "vitest";
import { renderConfirmationPrompt, renderAlertMessage } from "./templates.js";

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
