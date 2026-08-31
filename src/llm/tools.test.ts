import { describe, it, expect } from "vitest";
import { TOOLS } from "./tools.js";

describe("TOOLS", () => {
  it("defines all 9 v1 tools with mutating flags set correctly", () => {
    expect(Object.keys(TOOLS).sort()).toEqual(
      [
        "create_monitor", "list_monitors", "get_monitor_status", "pause_monitor",
        "resume_monitor", "delete_monitor", "edit_monitor", "get_summary", "get_monitor_history",
      ].sort(),
    );
    expect(TOOLS.create_monitor.mutating).toBe(true);
    expect(TOOLS.list_monitors.mutating).toBe(false);
    expect(TOOLS.get_monitor_history.mutating).toBe(false);
  });

  it("get_monitor_history schema requires an identifier and accepts an optional numeric limit", () => {
    expect(TOOLS.get_monitor_history.schema.safeParse({ identifier: "myapp" }).success).toBe(true);
    expect(TOOLS.get_monitor_history.schema.safeParse({ identifier: "myapp", limit: 5 }).success).toBe(true);
    expect(TOOLS.get_monitor_history.schema.safeParse({}).success).toBe(false);
    expect(TOOLS.get_monitor_history.schema.safeParse({ identifier: "myapp", limit: "five" }).success).toBe(false);
  });

  it("create_monitor schema requires a url and rejects malformed args", () => {
    expect(TOOLS.create_monitor.schema.safeParse({ url: "https://a.com", intervalSeconds: 60 }).success).toBe(true);
    expect(TOOLS.create_monitor.schema.safeParse({ intervalSeconds: 60 }).success).toBe(false);
    expect(TOOLS.create_monitor.schema.safeParse({ url: "https://a.com", intervalSeconds: "sixty" }).success).toBe(false);
  });

  it("create_monitor schema enforces the 60s poll floor", () => {
    expect(TOOLS.create_monitor.schema.safeParse({ url: "https://a.com", intervalSeconds: 30 }).success).toBe(false);
  });

  it("delete_monitor schema requires an identifier", () => {
    expect(TOOLS.delete_monitor.schema.safeParse({ identifier: "hanifautos" }).success).toBe(true);
    expect(TOOLS.delete_monitor.schema.safeParse({}).success).toBe(false);
  });
});
