import { describe, it, expect, vi, afterEach } from "vitest";
import { ConversationHistoryStore } from "./history.js";

describe("ConversationHistoryStore", () => {
  afterEach(() => vi.useRealTimers());

  it("returns appended turns in order", () => {
    const store = new ConversationHistoryStore();
    store.append("chan-1", { role: "user", text: "stop the monitor" });
    store.append("chan-1", { role: "assistant", text: "which one?" });
    expect(store.get("chan-1").map((t) => t.text)).toEqual(["stop the monitor", "which one?"]);
  });

  it("keeps history separate per channel", () => {
    const store = new ConversationHistoryStore();
    store.append("chan-1", { role: "user", text: "a" });
    store.append("chan-2", { role: "user", text: "b" });
    expect(store.get("chan-1")).toHaveLength(1);
    expect(store.get("chan-2")).toHaveLength(1);
  });

  it("keeps only the last 10 messages", () => {
    const store = new ConversationHistoryStore();
    for (let i = 0; i < 15; i++) store.append("chan-1", { role: "user", text: `msg-${i}` });
    const messages = store.get("chan-1");
    expect(messages).toHaveLength(10);
    expect(messages[0]!.text).toBe("msg-5");
  });

  it("drops messages older than 15 minutes", () => {
    vi.useFakeTimers();
    const store = new ConversationHistoryStore();
    store.append("chan-1", { role: "user", text: "old" });
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    store.append("chan-1", { role: "user", text: "new" });
    expect(store.get("chan-1").map((t) => t.text)).toEqual(["new"]);
  });
});
