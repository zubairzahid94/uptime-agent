import type { ToolName } from "../llm/tools.js";

export interface PendingAction {
  toolName: ToolName;
  args: unknown;
  createdAt: number;
}

const TTL_MS = 5 * 60 * 1000;

export class PendingActionStore {
  private entries = new Map<string, PendingAction>();

  private key(channelId: string, userId: string): string {
    return `${channelId}:${userId}`;
  }

  set(channelId: string, userId: string, action: PendingAction): void {
    this.entries.set(this.key(channelId, userId), action);
  }

  get(channelId: string, userId: string): PendingAction | undefined {
    const k = this.key(channelId, userId);
    const entry = this.entries.get(k);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > TTL_MS) {
      this.entries.delete(k);
      return undefined;
    }
    return entry;
  }

  clear(channelId: string, userId: string): void {
    this.entries.delete(this.key(channelId, userId));
  }
}
