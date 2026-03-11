/**
 * Permission Manager Tests
 * Unit tests for the permission manager implementation
 */

import { PermissionManagerImpl, PermissionConfig, PermissionRequest } from '../src/core/permission-manager';
import { ACPSessionHandlers, JsonRpcError } from '../src/core/acp-method-handlers';

describe('PermissionManager', () => {
  let permissionManager: PermissionManagerImpl;
  let acpSessionHandlers: ACPSessionHandlers;
  let mockUserConfirmation: jest.Mock<Promise<boolean>, [PermissionRequest]>;

  beforeEach(() => {
    const config: PermissionConfig = {
      allowedPaths: ['*.md', 'docs/*'],
      deniedPaths: ['secret/*', '*.key'],
      requireConfirmation: true,
      logOperations: true
    };

    mockUserConfirmation = jest.fn();
    permissionManager = new PermissionManagerImpl(config, mockUserConfirmation);
    acpSessionHandlers = new ACPSessionHandlers(permissionManager);
  });

  describe('requestPermission', () => {
    it('should grant permission for allowed paths with user confirmation', async () => {
      mockUserConfirmation.mockResolvedValue(true);

      const granted = await permissionManager.requestPermission('read', 'test.md');

      expect(granted).toBe(true);
      expect(mockUserConfirmation).toHaveBeenCalledWith({
        operation: 'read',
        resource: 'test.md',
        reason: undefined,
        sessionId: undefined
      });
    });

    it('should deny permission when user rejects confirmation', async () => {
      mockUserConfirmation.mockResolvedValue(false);

      const granted = await permissionManager.requestPermission('read', 'test.md');

      expect(granted).toBe(false);
      expect(mockUserConfirmation).toHaveBeenCalled();
    });

    it('should deny permission for denied paths', async () => {
      const granted = await permissionManager.requestPermission('read', 'secret/password.txt');

      expect(granted).toBe(false);
      expect(mockUserConfirmation).not.toHaveBeenCalled();
    });

    it('should deny permission for disallowed file types', async () => {
      const granted = await permissionManager.requestPermission('read', 'private.key');

      expect(granted).toBe(false);
      expect(mockUserConfirmation).not.toHaveBeenCalled();
    });

    it('should deny permission for paths not matching allowed patterns', async () => {
      const granted = await permissionManager.requestPermission('read', 'config.json');

      expect(granted).toBe(false);
      expect(mockUserConfirmation).not.toHaveBeenCalled();
    });

    it('should reuse session permissions', async () => {
      mockUserConfirmation.mockResolvedValue(true);

      // First request should ask for confirmation
      const granted1 = await permissionManager.requestPermission('read', 'test.md', undefined, 'session1');
      expect(granted1).toBe(true);
      expect(mockUserConfirmation).toHaveBeenCalledTimes(1);

      // Second request for same operation/resource should not ask again
      const granted2 = await permissionManager.requestPermission('read', 'test.md', undefined, 'session1');
      expect(granted2).toBe(true);
      expect(mockUserConfirmation).toHaveBeenCalledTimes(1);
    });

    it('should handle user confirmation errors gracefully', async () => {
      mockUserConfirmation.mockRejectedValue(new Error('User confirmation failed'));

      const granted = await permissionManager.requestPermission('read', 'test.md');

      expect(granted).toBe(false);
    });
  });

  describe('checkPermission', () => {
    it('should return true for session permissions', async () => {
      mockUserConfirmation.mockResolvedValue(true);
      
      // Grant permission first
      await permissionManager.requestPermission('read', 'test.md', undefined, 'session1');
      
      // Check should return true
      const hasPermission = permissionManager.checkPermission('read', 'test.md', 'session1');
      expect(hasPermission).toBe(true);
    });

    it('should return false for denied paths', () => {
      const hasPermission = permissionManager.checkPermission('read', 'secret/password.txt');
      expect(hasPermission).toBe(false);
    });

    it('should return false for disallowed paths', () => {
      const hasPermission = permissionManager.checkPermission('read', 'config.json');
      expect(hasPermission).toBe(false);
    });
  });

  describe('revokePermissions', () => {
    it('should revoke all session permissions', async () => {
      mockUserConfirmation.mockResolvedValue(true);
      
      // Grant some permissions
      await permissionManager.requestPermission('read', 'test1.md', undefined, 'session1');
      await permissionManager.requestPermission('write', 'test2.md', undefined, 'session1');
      
      // Verify permissions exist
      expect(permissionManager.checkPermission('read', 'test1.md', 'session1')).toBe(true);
      expect(permissionManager.checkPermission('write', 'test2.md', 'session1')).toBe(true);
      
      // Revoke permissions
      permissionManager.revokePermissions('session1');
      
      // Verify permissions are revoked
      expect(permissionManager.checkPermission('read', 'test1.md', 'session1')).toBe(false);
      expect(permissionManager.checkPermission('write', 'test2.md', 'session1')).toBe(false);
    });

    it('should handle revoking non-existent session gracefully', () => {
      expect(() => permissionManager.revokePermissions('nonexistent')).not.toThrow();
    });
  });

  describe('logOperation', () => {
    it('should log operations when enabled', () => {
      permissionManager.logOperation('read', 'test.md', true);
      
      const log = permissionManager.getOperationLog();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        operation: 'read',
        resource: 'test.md',
        granted: true
      });
      expect(log[0].timestamp).toBeInstanceOf(Date);
    });

    it('should not log operations when disabled', () => {
      const config: PermissionConfig = {
        allowedPaths: [],
        deniedPaths: [],
        requireConfirmation: false,
        logOperations: false
      };
      
      const manager = new PermissionManagerImpl(config);
      manager.logOperation('read', 'test.md', true);
      
      const log = manager.getOperationLog();
      expect(log).toHaveLength(0);
    });

    it('should clear operation log', () => {
      permissionManager.logOperation('read', 'test.md', true);
      expect(permissionManager.getOperationLog()).toHaveLength(1);
      
      permissionManager.clearOperationLog();
      expect(permissionManager.getOperationLog()).toHaveLength(0);
    });
  });

  describe('pattern matching', () => {
    it('should match wildcard patterns', async () => {
      const config: PermissionConfig = {
        allowedPaths: ['*'],
        deniedPaths: [],
        requireConfirmation: false,
        logOperations: false
      };
      
      const manager = new PermissionManagerImpl(config);
      
      expect(manager.checkPermission('read', 'any-file.txt')).toBe(true);
      expect(manager.checkPermission('read', 'deep/nested/file.md')).toBe(true);
    });

    it('should match specific patterns', async () => {
      const config: PermissionConfig = {
        allowedPaths: ['docs/*.md', 'config.json'],
        deniedPaths: [],
        requireConfirmation: false,
        logOperations: false
      };
      
      const manager = new PermissionManagerImpl(config);
      
      expect(manager.checkPermission('read', 'docs/readme.md')).toBe(true);
      expect(manager.checkPermission('read', 'config.json')).toBe(true);
      expect(manager.checkPermission('read', 'other.txt')).toBe(false);
    });
  });

  describe('configuration updates', () => {
    it('should update configuration', () => {
      permissionManager.updateConfig({
        requireConfirmation: false,
        allowedPaths: ['*']
      });
      
      // Should now grant permission without confirmation
      const hasPermission = permissionManager.checkPermission('read', 'any-file.txt');
      expect(hasPermission).toBe(true);
    });

    it('should update user confirmation handler', async () => {
      const newHandler = jest.fn().mockResolvedValue(false);
      permissionManager.setUserConfirmationHandler(newHandler);
      
      const granted = await permissionManager.requestPermission('read', 'test.md');
      
      expect(granted).toBe(false);
      expect(newHandler).toHaveBeenCalled();
      expect(mockUserConfirmation).not.toHaveBeenCalled();
    });
  });

  describe('ACP session/request_permission handler', () => {
    it('should handle valid permission requests', async () => {
      mockUserConfirmation.mockResolvedValue(true);

      const result = await acpSessionHandlers.handleSessionRequestPermission({
        sessionId: 'test-session',
        toolCall: {
          toolCallId: 'call_001',
          kind: 'read',
          path: 'test.md',
          title: 'Need to read file for analysis'
        },
        options: [
          { optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' },
          { optionId: 'reject_once', name: 'Reject Once', kind: 'reject_once' }
        ]
      });

      expect(result.outcome.outcome).toBe('selected');
      expect(result.outcome.optionId).toBe('allow_once');
      expect(mockUserConfirmation).toHaveBeenCalledWith({
        operation: 'read',
        resource: 'test.md',
        reason: 'Need to read file for analysis',
        sessionId: 'test-session'
      });
    });

    it('should validate required parameters', async () => {
      await expect(acpSessionHandlers.handleSessionRequestPermission({} as any))
        .rejects.toThrow(JsonRpcError);

      await expect(acpSessionHandlers.handleSessionRequestPermission({
        sessionId: 'test-session',
        toolCall: {
          toolCallId: 'call_001',
          kind: '',
          path: 'test.md'
        },
        options: [{ optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' }]
      } as any))
        .rejects.toThrow(JsonRpcError);

      await expect(acpSessionHandlers.handleSessionRequestPermission({
        sessionId: 'test-session',
        toolCall: {
          toolCallId: 'call_001',
          kind: 'read',
          path: ''
        },
        options: [{ optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' }]
      } as any))
        .rejects.toThrow(JsonRpcError);
    });

    it('should validate parameter types', async () => {
      await expect(acpSessionHandlers.handleSessionRequestPermission({
        operation: 123,
        resource: 'test.md'
      } as any))
        .rejects.toThrow(JsonRpcError);

      await expect(acpSessionHandlers.handleSessionRequestPermission({
        operation: 'read',
        resource: 123
      } as any))
        .rejects.toThrow(JsonRpcError);

      await expect(acpSessionHandlers.handleSessionRequestPermission({
        operation: 'read',
        resource: 'test.md',
        reason: 123
      } as any))
        .rejects.toThrow(JsonRpcError);
    });

    it('should return proper JSON-RPC errors', async () => {
      // Permission denied should return false, not throw
      const result = await acpSessionHandlers.handleSessionRequestPermission({
        sessionId: 'test-session',
        toolCall: {
          toolCallId: 'call_001',
          kind: 'read',
          path: 'secret/password.txt'
        },
        options: [
          { optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' },
          { optionId: 'reject_once', name: 'Reject Once', kind: 'reject_once' }
        ]
      });
      
      expect(result.outcome.outcome).toBe('selected');
      expect(result.outcome.optionId).toBe('reject_once');
    });
  });
});