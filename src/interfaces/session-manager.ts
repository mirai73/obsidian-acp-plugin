/**
 * Session Manager Interface
 * Defines the contract for managing ACP sessions and conversations
 */

import { Message, PromptResult, SessionUpdate, SessionNewParams } from '../types/acp';

export interface SessionManager {
  createSession(cwd?: string, mcpServers?: SessionNewParams['mcpServers']): Promise<{sessionId: string}>;
  sendPrompt(sessionId: string, messages: Message[]): Promise<PromptResult>;
  cancelSession(sessionId: string): Promise<void>;
  updateSession(sessionId: string, update: SessionUpdate): void;
}