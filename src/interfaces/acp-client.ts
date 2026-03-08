/**
 * ACP Client Interface
 * Defines the contract for the main ACP client component
 */

import { FsReadTextFileParams, FsReadTextFileResult, FsWriteTextFileParams, SessionRequestPermissionParams, SessionRequestPermissionResult, SessionUpdateParams } from '../types/acp';

export interface ACPClient {
  // Process management
  startAgent(agentPath: string, args: string[]): Promise<void>;
  stopAgent(): Promise<void>;
  
  // JSON-RPC communication
  sendRequest(method: string, params: any): Promise<any>;
  sendNotification(method: string, params: any): void;
  
  // Method handlers (what Obsidian implements)
  handleFsReadTextFile(params: FsReadTextFileParams): Promise<FsReadTextFileResult>;
  handleFsWriteTextFile(params: FsWriteTextFileParams): Promise<void>;
  handleSessionRequestPermission(params: SessionRequestPermissionParams): Promise<SessionRequestPermissionResult>;
  handleSessionUpdate(params: SessionUpdateParams): void;
}