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

export interface SessionManager {
  createSession(
    agentId: string,
    jsonRpcClient: JsonRpcClient,
    cwd?: string,
    mcpServers?: SessionNewParams['mcpServers']
  ): Promise<{ sessionId: string }>;
  sendPrompt(sessionId: string, messages: Message[]): Promise<PromptResult>;
  cancelSession(sessionId: string): Promise<void>;
  updateSession(sessionId: string, update: SessionUpdate): void;
  setMode(sessionId: string, modeId: string): Promise<void>;
  handleStreamingUpdate(params: any): void;
  getSessionInfo(sessionId: string): any | null;
}
