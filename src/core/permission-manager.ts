import { PermissionManager } from '../interfaces/permission-manager';
import {
  SessionRequestPermissionParams,
  SessionRequestPermissionResult,
} from '../types/acp';

export interface PermissionConfig {
  allowedPaths: string[];
  readOnlyPaths: string[];
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

/**
 * Permission Manager Implementation
 * Manages file access permissions, user confirmations, and audit logging
 */
export class PermissionManagerImpl implements PermissionManager {
  private config: PermissionConfig;
  private operationLog: PermissionEntry[] = [];
  private userConfirmationHandler?: (
    params: SessionRequestPermissionParams
  ) => Promise<SessionRequestPermissionResult>;

  constructor(
    config: PermissionConfig,
    userConfirmationHandler?: (
      params: SessionRequestPermissionParams
    ) => Promise<SessionRequestPermissionResult>
  ) {
    this.config = config;
    this.userConfirmationHandler = userConfirmationHandler;
  }

  /**
   * Request permission for an operation on a resource
   * Delegates entirely to the user confirmation handler UI
   */
  async requestPermission(
    params: SessionRequestPermissionParams
  ): Promise<SessionRequestPermissionResult> {
    const operation = params.toolCall.kind || 'unknown';
    // Handle either old format (path/resource directly) or new format (locations)
    const resource =
      (params.toolCall.locations && params.toolCall.locations.length > 0
        ? params.toolCall.locations[0].path
        : null) ||
      params.toolCall.path ||
      params.toolCall.resource ||
      'unknown';

    // Denied paths take precedence
    if (this.isResourceDenied(resource)) {
      this.logOperation(operation, resource, false);
      return { outcome: { outcome: 'declined' } };
    }

    // Check for read-only paths when doing a write operation
    if (this.isWriteOperation(operation) && this.isResourceReadOnly(resource)) {
      this.logOperation(operation, resource, false);
      return { outcome: { outcome: 'declined' } };
    }

    // Check if it's allowed
    if (!this.isResourceAllowed(resource)) {
      this.logOperation(operation, resource, false);
      return { outcome: { outcome: 'declined' } };
    }

    // If no user confirmation is required, auto-allow!
    if (!this.config.requireConfirmation) {
      this.logOperation(operation, resource, true);
      // Try to automatically find the option that allows the operation
      const allowOption = params.options.find((o) =>
        o.kind.startsWith('allow')
      );
      if (allowOption) {
        return {
          outcome: { outcome: 'selected', optionId: allowOption.optionId },
        };
      }
      return { outcome: { outcome: 'declined' } };
    }

    if (!this.userConfirmationHandler) {
      console.warn(
        'No user confirmation handler registered; cancelling permission request.'
      );
      this.logOperation(operation, resource, false);
      return { outcome: { outcome: 'cancelled' } };
    }

    try {
      const result = await this.userConfirmationHandler(params);

      // Best-effort attempt to log whether the operation was "granted"
      let granted = false;
      if (result.outcome.outcome === 'selected' && result.outcome.optionId) {
        const selectedOption = params.options.find(
          (o) => o.optionId === result.outcome.optionId
        );
        if (selectedOption && selectedOption.kind.startsWith('allow')) {
          granted = true;
        }
      }

      this.logOperation(operation, resource, granted);
      return result;
    } catch (error) {
      console.error('Error requesting user confirmation:', error);
      this.logOperation(operation, resource, false);
      return { outcome: { outcome: 'cancelled' } };
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
      timestamp: new Date(),
    };

    this.operationLog.push(entry);
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
  setUserConfirmationHandler(
    handler: (
      params: SessionRequestPermissionParams
    ) => Promise<SessionRequestPermissionResult>
  ): void {
    this.userConfirmationHandler = handler;
  }

  // Private helper methods

  private isResourceAllowed(resource: string): boolean {
    // If no allowed paths configured, allow all
    if (this.config.allowedPaths.length === 0) {
      return true;
    }

    // Check if resource matches any allowed path pattern
    return this.config.allowedPaths.some((pattern) =>
      this.matchesPattern(resource, pattern)
    );
  }

  private isResourceDenied(resource: string): boolean {
    // Check if resource matches any denied path pattern
    return this.config.deniedPaths.some((pattern) =>
      this.matchesPattern(resource, pattern)
    );
  }

  private isResourceReadOnly(resource: string): boolean {
    // Check if resource matches any read-only path pattern
    return this.config.readOnlyPaths.some((pattern) =>
      this.matchesPattern(resource, pattern)
    );
  }

  private isWriteOperation(operation: string): boolean {
    const writeOperations = [
      'fs_writeTextFile',
      'fs_appendFile',
      'fs_deleteFile',
      'fs_createDirectory',
      'fs_rename',
      'fs_copyFile',
      'mcp_callTool', // Some tools might write, though we might need to be more careful. Let's assume write operations are the main issue.
    ];
    return writeOperations.includes(operation);
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
