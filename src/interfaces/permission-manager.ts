/**
 * Permission Manager Interface
 * Defines the contract for handling user permissions and access control
 */

export interface PermissionManager {
  requestPermission(operation: string, resource: string): Promise<boolean>;
  checkPermission(operation: string, resource: string): boolean;
  revokePermissions(sessionId: string): void;
  logOperation(operation: string, resource: string, granted: boolean): void;
}