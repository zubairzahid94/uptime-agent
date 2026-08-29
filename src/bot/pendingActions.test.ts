import { describe, it, expect, vi, afterEach } from "vitest";
import { PendingActionStore } from "./pendingActions.js";

describe("PendingActionStore", () => {
  afterEach(() => vi.useRealTimers());

  it("stores and retrieves a pending action keyed by (channelId, userId)", () => {
    const store = new PendingActionStore();
    store.set("chan-1", "user-1", { toolName: "delete_monitor", args: { identifier: "a" }, createdAt: Date.now() });
    expect(store.get("chan-1", "user-1")?.toolName).toBe("delete_monitor");
  });

  it("does not leak across different users in the same channel", () => {
    const store = new PendingActionStore();
    store.set("chan-1", "user-1", { toolName: "delete_monitor", args: {}, createdAt: Date.now() });
    expect(store.get("chan-1", "user-2")).toBeUndefined();
  });

  it("overwrites an existing pending entry for the same key", () => {
    const store = new PendingActionStore();
    store.set("chan-1", "user-1", { toolName: "pause_monitor", args: {}, createdAt: Date.now() });
    store.set("chan-1", "user-1", { toolName: "delete_monitor", args: {}, createdAt: Date.now() });
    expect(store.get("chan-1", "user-1")?.toolName).toBe("delete_monitor");
  });

  it("expires an entry after 5 minutes", () => {
    vi.useFakeTimers();
    const store = new PendingActionStore();
    store.set("chan-1", "user-1", { toolName: "delete_monitor", args: {}, createdAt: Date.now() });
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(store.get("chan-1", "user-1")).toBeUndefined();
  });

  it("clear removes an entry", () => {
    const store = new PendingActionStore();
    store.set("chan-1", "user-1", { toolName: "delete_monitor", args: {}, createdAt: Date.now() });
    store.clear("chan-1", "user-1");
    expect(store.get("chan-1", "user-1")).toBeUndefined();
  });
});
