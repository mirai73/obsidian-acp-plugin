/**
 * Permission Manager Interface
 * Defines the contract for handling user permissions and access control
 */

import { SessionRequestPermissionParams, SessionRequestPermissionResult } from '../types/acp';

export interface PermissionManager {
  requestPermission(params: SessionRequestPermissionParams): Promise<SessionRequestPermissionResult>;
  logOperation(operation: string, resource: string, granted: boolean): void;
}