/**
 * Permission Manager Implementation
 * Handles user permission requests, access control, and audit logging
 */

import { PermissionManager } from '../interfaces/permission-manager';

export interface PermissionConfig {
  allowedPaths: string[];
  deniedPaths: string[];
  requireConfirmation: boolean;
  logOperations: boolean;
}

export interface PermissionEntry {
  operation: string;
  resource: string;
  granted: boolean;
  timestamp: Date;
  sessionId?: string;
}

export interface PermissionRequest {
  operation: string;
  resource: string;
  reason?: string;
  sessionId?: string;
}

/**
 * Permission Manager Implementation
 * Manages file access permissions, user confirmations, and audit logging
 */
export class PermissionManagerImpl implements PermissionManager {
  private config: PermissionConfig;
  private grantedPermissions: Map<string, Set<string>> = new Map(); // sessionId -> Set<operation:resource>
  private operationLog: PermissionEntry[] = [];
  private userConfirmationHandler?: (request: PermissionRequest) => Promise<boolean>;

  constructor(
    config: PermissionConfig,
    userConfirmationHandler?: (request: PermissionRequest) => Promise<boolean>
  ) {
    this.config = config;
    this.userConfirmationHandler = userConfirmationHandler;
  }

  /**
   * Request permission for an operation on a resource
   * Shows user confirmation dialog if required
   */
  async requestPermission(
    operation: string, 
    resource: string, 
    reason?: string,
    sessionId?: string
  ): Promise<boolean> {
    const request: PermissionRequest = {
      operation,
      resource,
      reason,
      sessionId
    };

    // Check if permission is already granted for this session
    if (sessionId && this.hasSessionPermission(sessionId, operation, resource)) {
      this.logOperation(operation, resource, true);
      return true;
    }

    // Check against denied paths first
    if (this.isResourceDenied(resource)) {
      this.logOperation(operation, resource, false);
      return false;
    }

    // Check against allowed paths
    if (!this.isResourceAllowed(resource)) {
      this.logOperation(operation, resource, false);
      return false;
    }

    let granted = true;

    // Request user confirmation if required
    if (this.config.requireConfirmation && this.userConfirmationHandler) {
      try {
        granted = await this.userConfirmationHandler(request);
      } catch (error) {
        console.error('Error requesting user confirmation:', error);
        granted = false;
      }
    }

    // Store granted permission for the session
    if (granted && sessionId) {
      this.grantSessionPermission(sessionId, operation, resource);
    }

    this.logOperation(operation, resource, granted);
    return granted;
  }

  /**
   * Check if permission is already granted for an operation on a resource
   */
  checkPermission(operation: string, resource: string, sessionId?: string): boolean {
    // Check session-specific permissions first
    if (sessionId && this.hasSessionPermission(sessionId, operation, resource)) {
      return true;
    }

    // Check against denied paths
    if (this.isResourceDenied(resource)) {
      return false;
    }

    // Check against allowed paths
    if (!this.isResourceAllowed(resource)) {
      return false;
    }

    // If no confirmation required, permission is granted
    return !this.config.requireConfirmation;
  }

  /**
   * Revoke all permissions for a session
   */
  revokePermissions(sessionId: string): void {
    const permissions = this.grantedPermissions.get(sessionId);
    if (permissions) {
      // Log revocation of each permission
      for (const permissionKey of permissions) {
        const [operation, resource] = permissionKey.split(':', 2);
        this.logOperation(`revoke_${operation}`, resource, true);
      }
      
      this.grantedPermissions.delete(sessionId);
    }
  }

  /**
   * Log an operation for audit purposes
   */
  logOperation(operation: string, resource: string, granted: boolean): void {
    if (!this.config.logOperations) {
      return;
    }

    const entry: PermissionEntry = {
      operation,
      resource,
      granted,
      timestamp: new Date()
    };

    this.operationLog.push(entry);

    // Log to console for debugging
    console.log(`Permission ${granted ? 'GRANTED' : 'DENIED'}: ${operation} on ${resource}`);
  }

  /**
   * Get operation log for audit purposes
   */
  getOperationLog(): PermissionEntry[] {
    return [...this.operationLog];
  }

  /**
   * Clear operation log
   */
  clearOperationLog(): void {
    this.operationLog = [];
  }

  /**
   * Update permission configuration
   */
  updateConfig(config: Partial<PermissionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set user confirmation handler
   */
  setUserConfirmationHandler(handler: (request: PermissionRequest) => Promise<boolean>): void {
    this.userConfirmationHandler = handler;
  }

  // Private helper methods

  private hasSessionPermission(sessionId: string, operation: string, resource: string): boolean {
    const permissions = this.grantedPermissions.get(sessionId);
    if (!permissions) {
      return false;
    }
    
    const permissionKey = `${operation}:${resource}`;
    return permissions.has(permissionKey);
  }

  private grantSessionPermission(sessionId: string, operation: string, resource: string): void {
    if (!this.grantedPermissions.has(sessionId)) {
      this.grantedPermissions.set(sessionId, new Set());
    }
    
    const permissions = this.grantedPermissions.get(sessionId)!;
    const permissionKey = `${operation}:${resource}`;
    permissions.add(permissionKey);
  }

  private isResourceAllowed(resource: string): boolean {
    // If no allowed paths configured, allow all
    if (this.config.allowedPaths.length === 0) {
      return true;
    }

    // Check if resource matches any allowed path pattern
    return this.config.allowedPaths.some(pattern => this.matchesPattern(resource, pattern));
  }

  private isResourceDenied(resource: string): boolean {
    // Check if resource matches any denied path pattern
    return this.config.deniedPaths.some(pattern => this.matchesPattern(resource, pattern));
  }

  private matchesPattern(resource: string, pattern: string): boolean {
    // Simple pattern matching - supports wildcards
    if (pattern === '*') {
      return true;
    }

    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(resource);
  }
}