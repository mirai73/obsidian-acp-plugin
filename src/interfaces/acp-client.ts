/**
 * ACP Client Interface
 * Defines the contract for the main ACP client component
 */

import { AgentConnection } from 'src/core/acp-client-impl';
import {
  FsReadTextFileParams,
  FsReadTextFileResult,
  FsWriteTextFileParams,
  SessionRequestPermissionParams,
  SessionRequestPermissionResult,
  SessionUpdateParams,
} from '../types/acp';

export interface ACPClient {
  // Process management
  startAgent(agentId: string, agentPath: string, args: string[]): Promise<void>;
  stopAgent(): Promise<void>;
  getConnections(): Map<string, AgentConnection>;
  // JSON-RPC communication
  sendRequest(method: string, params: any): Promise<any>;
  sendNotification(method: string, params: any): void;

  // Method handlers (what Obsidian implements)
  handleFsReadTextFile(
    params: FsReadTextFileParams
  ): Promise<FsReadTextFileResult>;
  handleFsWriteTextFile(params: FsWriteTextFileParams): Promise<void>;
  handleSessionRequestPermission(
    params: SessionRequestPermissionParams
  ): Promise<SessionRequestPermissionResult>;
  handleSessionUpdate(params: SessionUpdateParams): void;

  getSessionManager(): any | undefined;
}
