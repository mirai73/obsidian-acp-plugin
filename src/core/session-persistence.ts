/**
 * Session Persistence Service
 *
 * Saves and loads chat sessions using Obsidian's plugin data store
 * (the same `loadData` / `saveData` mechanism used for settings).
 *
 * Sessions are stored as plain JSON inside `PluginSettings.persistedSessions`.
 * Each record is identified by a stable UUID generated at save time, not the
 * live agent session ID (which is ephemeral and changes every connection).
 */

import type { SessionContext } from './session-manager';
import type {
  PersistedSession,
  PersistedMessage,
  PersistedContentBlock,
} from '../types/plugin';

/** Minimal plugin interface required by the persistence service. */
export interface PersistencePlugin {
  settings: {
    persistedSessions: PersistedSession[];
    sessions: {
      enabled: boolean;
      autoCleanup: boolean;
      cleanupAfterDays: number;
    };
  };
  saveSettings(): Promise<void>;
}

/**
 * Generates a simple UUID-v4-like string without external dependencies.
 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class SessionPersistenceService {
  constructor(private readonly plugin: PersistencePlugin) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Whether persistence is currently enabled. */
  get isEnabled(): boolean {
    return this.plugin.settings.sessions.enabled;
  }

  /**
   * Persist a live `SessionContext` to plugin data.
   * No-op when persistence is disabled.
   *
   * If a record with the same `persistedId` already exists it is updated in
   * place; otherwise a new record is appended.
   *
   * @param session     The live session context to persist.
   * @param persistedId Optional stable ID for the record. When omitted a new
   *                    UUID is generated and returned so the caller can store
   *                    it for future updates.
   * @returns The stable persisted record ID, or `null` when disabled.
   */
  async saveSession(
    session: SessionContext,
    persistedId?: string
  ): Promise<string | null> {
    if (!this.isEnabled) return null;

    const id = persistedId ?? generateId();

    const record: PersistedSession = {
      id,
      agentId: session.agentId,
      agentSessionId: session.sessionId,
      createdAt:
        session.createdAt instanceof Date
          ? session.createdAt.toISOString()
          : String(session.createdAt),
      lastActivity:
        session.lastActivity instanceof Date
          ? session.lastActivity.toISOString()
          : String(session.lastActivity),
      messages: this.serializeMessages(session),
      attachedDocumentPath: session.attachedDocumentPath,
    };

    const sessions = this.plugin.settings.persistedSessions;
    const existingIndex = sessions.findIndex((s) => s.id === id);

    if (existingIndex >= 0) {
      sessions[existingIndex] = record;
    } else {
      sessions.push(record);
    }

    await this.plugin.saveSettings();
    return id;
  }

  /**
   * Delete a single persisted session by its stable ID.
   */
  async deleteSession(persistedId: string): Promise<void> {
    this.plugin.settings.persistedSessions =
      this.plugin.settings.persistedSessions.filter(
        (s) => s.id !== persistedId
      );
    await this.plugin.saveSettings();
  }

  /**
   * Delete all persisted sessions.
   */
  async deleteAllSessions(): Promise<void> {
    this.plugin.settings.persistedSessions = [];
    await this.plugin.saveSettings();
  }

  /**
   * Return all persisted sessions, newest first.
   * Returns an empty array when persistence is disabled.
   */
  getAllSessions(): PersistedSession[] {
    if (!this.isEnabled) return [];
    return [...this.plugin.settings.persistedSessions].sort(
      (a, b) =>
        new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );
  }

  /**
   * Return a single persisted session by its stable ID, or `null`.
   */
  getSession(persistedId: string): PersistedSession | null {
    if (!this.isEnabled) return null;
    return (
      this.plugin.settings.persistedSessions.find(
        (s) => s.id === persistedId
      ) ?? null
    );
  }

  /**
   * Remove sessions whose `lastActivity` is older than the configured number
   * of days. Only runs when both `enabled` and `autoCleanup` are true.
   *
   * @returns The number of sessions that were removed.
   */
  async runAutoCleanup(): Promise<number> {
    const cfg = this.plugin.settings.sessions;
    if (!cfg.enabled || !cfg.autoCleanup) return 0;

    const cutoff = Date.now() - cfg.cleanupAfterDays * 24 * 60 * 60 * 1000;
    const before = this.plugin.settings.persistedSessions.length;

    this.plugin.settings.persistedSessions =
      this.plugin.settings.persistedSessions.filter(
        (s) => new Date(s.lastActivity).getTime() >= cutoff
      );

    const removed = before - this.plugin.settings.persistedSessions.length;
    if (removed > 0) {
      await this.plugin.saveSettings();
    }
    return removed;
  }

  // ---------------------------------------------------------------------------
  // Serialisation helpers
  // ---------------------------------------------------------------------------

  serializeMessages(session: SessionContext): PersistedMessage[] {
    return session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
          .filter((b) => this.isSerializableBlock(b))
          .map((b) => this.serializeBlock(b)),
      }))
      .filter((m) => m.content.length > 0);
  }

  private isSerializableBlock(block: any): boolean {
    return ['text', 'image', 'diff', 'resource', 'resource_link'].includes(
      block.type
    );
  }

  private serializeBlock(block: any): PersistedContentBlock {
    const out: PersistedContentBlock = { type: block.type };
    if (block.text !== undefined) out.text = block.text;
    if (block.data !== undefined) out.data = block.data;
    if (block.mimeType !== undefined) out.mimeType = block.mimeType;
    if (block.source !== undefined) out.source = block.source;
    if (block.uri !== undefined) out.uri = block.uri;
    if (block.name !== undefined) out.name = block.name;
    if (block.size !== undefined) out.size = block.size;
    return out;
  }
}
