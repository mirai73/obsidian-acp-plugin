/**
 * Session Manager Interface
 * Defines the contract for managing ACP sessions and conversations
 */

import {
  Message,
  PromptResult,
  SessionUpdate,
  SessionNewParams,
} from '../types/acp';
import { JsonRpcClient } from '../core/json-rpc-client';

/** Unified session summary returned by getSessions(). */
export interface SessionSummary {
  /** The session ID — live agent session ID for in-memory sessions,
   *  or the stable persisted record ID for disk-only sessions. */
  sessionId: string;
  /** The agent this session belongs to. */
  agentId: string;
  /** ISO-8601 or Date of when the session was created. */
  createdAt: Date;
  /** ISO-8601 or Date of the last message activity. */
  lastActivity: Date;
  /** Number of messages in the conversation. */
  messageCount: number;
  /** Preview text from the first user message. */
  preview: string;
  /** True when the session is live in memory and can accept new prompts. */
  isLive: boolean;
  /** True when the session has a persisted record on disk. */
  isPersisted: boolean;
  /** Optional path of the document attached to this session. */
  attachedDocumentPath?: string;
}

export interface SessionManager {
  createSession(
    agentId: string,
    jsonRpcClient: JsonRpcClient,
    cwd?: string,
    mcpServers?: SessionNewParams['mcpServers']
  ): Promise<{ sessionId: string }>;

  /**
   * Load a session by ID.
   *
   * - If the session is already live in memory, returns its sessionId immediately.
   * - If the session exists only on disk:
   *   - When `agentCapabilities.loadSession` is true → calls `session/load` so
   *     the agent restores its own context and replays history.
   *   - Otherwise → calls `session/new` and hydrates messages client-side only.
   *
   * @param id  Live session ID or persisted record ID.
   * @param jsonRpcClient  Required when the session must be recreated from disk.
   * @param cwd  Working directory for the new agent session (disk restore only).
   * @param agentCapabilities  Negotiated agent capabilities from `initialize`.
   */
  loadSession(
    id: string,
    jsonRpcClient?: JsonRpcClient,
    cwd?: string,
    agentCapabilities?: { loadSession?: boolean }
  ): Promise<string>;

  /**
   * Return a unified list of all known sessions — both live (in-memory) and
   * persisted (on disk) — deduplicated and sorted newest-first.
   */
  getSessions(): SessionSummary[];

  sendPrompt(sessionId: string, messages: Message[]): Promise<PromptResult>;
  cancelSession(sessionId: string): Promise<void>;
  updateSession(sessionId: string, update: SessionUpdate): void;
  setMode(sessionId: string, modeId: string): Promise<void>;
  handleStreamingUpdate(params: any): void;
  getSessionInfo(sessionId: string): any | null;
}
