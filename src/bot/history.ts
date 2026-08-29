import type { ChatTurn } from "../llm/adapter.js";

const MAX_MESSAGES = 10;
const MAX_AGE_MS = 15 * 60 * 1000;

interface TimedTurn extends ChatTurn {
  at: number;
}

export class ConversationHistoryStore {
  private byChannel = new Map<string, TimedTurn[]>();

  append(channelId: string, turn: ChatTurn): void {
    const existing = this.byChannel.get(channelId) ?? [];
    existing.push({ ...turn, at: Date.now() });
    this.byChannel.set(channelId, existing);
  }

  get(channelId: string): ChatTurn[] {
    const now = Date.now();
    const existing = this.byChannel.get(channelId) ?? [];
    const fresh = existing.filter((t) => now - t.at <= MAX_AGE_MS).slice(-MAX_MESSAGES);
    this.byChannel.set(channelId, fresh);
    return fresh.map(({ role, text }): ChatTurn => ({ role, text }));
  }
}
