/**
 * Permission Manager Tests
 * Unit tests for the permission manager implementation
 */

import {
  PermissionManagerImpl,
  PermissionConfig,
} from '../src/core/permission-manager';
import {
  ACPSessionHandlers,
  JsonRpcError,
} from '../src/core/acp-method-handlers';
import {
  SessionRequestPermissionParams,
  SessionRequestPermissionResult,
} from '../src/types/acp';

describe('PermissionManager', () => {
  let permissionManager: PermissionManagerImpl;
  let acpSessionHandlers: ACPSessionHandlers;
  let mockUserConfirmation: jest.Mock<
    Promise<SessionRequestPermissionResult>,
    [SessionRequestPermissionParams]
  >;

  beforeEach(() => {
    const config: PermissionConfig = {
      allowedPaths: [],
      deniedPaths: [],
      readOnlyPaths: [],
      requireConfirmation: true,
      logOperations: true,
    };
    mockUserConfirmation = jest.fn();
    permissionManager = new PermissionManagerImpl(config, mockUserConfirmation);
    acpSessionHandlers = new ACPSessionHandlers(permissionManager);
  });

  const createMockParams = (): SessionRequestPermissionParams => ({
    sessionId: 'test-session',
    toolCall: {
      toolCallId: 'call_001',
      kind: 'read',
      path: 'test.md',
      title: 'Need to read file for analysis',
    },
    options: [
      { optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' },
      { optionId: 'reject_once', name: 'Reject Once', kind: 'reject_once' },
    ],
  });

  describe('requestPermission', () => {
    it('should delegate to user confirmation handler and return result', async () => {
      const mockResult: SessionRequestPermissionResult = {
        outcome: { outcome: 'selected', optionId: 'allow_once' },
      };
      mockUserConfirmation.mockResolvedValue(mockResult);

      const params = createMockParams();
      const result = await permissionManager.requestPermission(params);

      expect(result).toEqual(mockResult);
      expect(mockUserConfirmation).toHaveBeenCalledWith(params);
    });

    it('should return cancelled if no handler is registered', async () => {
      const config: PermissionConfig = {
        allowedPaths: [],
        deniedPaths: [],
        readOnlyPaths: [],
        requireConfirmation: true,
        logOperations: true,
      };
      const noHandlerManager = new PermissionManagerImpl(config);
      const params = createMockParams();

      const result = await noHandlerManager.requestPermission(params);

      expect(result.outcome.outcome).toBe('cancelled');
    });

    it('should handle user confirmation errors gracefully and cancel', async () => {
      mockUserConfirmation.mockRejectedValue(
        new Error('User confirmation failed')
      );

      const params = createMockParams();
      const result = await permissionManager.requestPermission(params);

      expect(result.outcome.outcome).toBe('cancelled');
    });
  });

  describe('logOperation', () => {
    it('should log operations as granted when allowed', async () => {
      mockUserConfirmation.mockResolvedValue({
        outcome: { outcome: 'selected', optionId: 'allow_once' },
      });

      await permissionManager.requestPermission(createMockParams());

      const log = permissionManager.getOperationLog();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        operation: 'read',
        resource: 'test.md',
        granted: true,
      });
      expect(log[0].timestamp).toBeInstanceOf(Date);
    });

    it('should log operations as denied when rejected', async () => {
      mockUserConfirmation.mockResolvedValue({
        outcome: { outcome: 'selected', optionId: 'reject_once' },
      });

      await permissionManager.requestPermission(createMockParams());

      const log = permissionManager.getOperationLog();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        operation: 'read',
        resource: 'test.md',
        granted: false,
      });
    });

    it('should not log operations when disabled via config', async () => {
      const config: PermissionConfig = {
        allowedPaths: [],
        readOnlyPaths: [],
        deniedPaths: [],
        requireConfirmation: true,
        logOperations: false,
      };
      const noLogManager = new PermissionManagerImpl(
        config,
        mockUserConfirmation
      );
      mockUserConfirmation.mockResolvedValue({
        outcome: { outcome: 'selected', optionId: 'allow_once' },
      });

      await noLogManager.requestPermission(createMockParams());
      expect(noLogManager.getOperationLog()).toHaveLength(0);
    });

    it('should clear operation log', () => {
      permissionManager.logOperation('read', 'test.md', true);
      expect(permissionManager.getOperationLog()).toHaveLength(1);

      permissionManager.clearOperationLog();
      expect(permissionManager.getOperationLog()).toHaveLength(0);
    });
  });

  describe('configuration updates', () => {
    it('should update user confirmation handler', async () => {
      const newHandler = jest.fn().mockResolvedValue({
        outcome: { outcome: 'cancelled' },
      });
      permissionManager.setUserConfirmationHandler(newHandler);

      const result =
        await permissionManager.requestPermission(createMockParams());

      expect(result.outcome.outcome).toBe('cancelled');
      expect(newHandler).toHaveBeenCalled();
      expect(mockUserConfirmation).not.toHaveBeenCalled();
    });
  });

  describe('ACP session/request_permission handler', () => {
    it('should handle valid permission requests and delegate', async () => {
      const mockResult: SessionRequestPermissionResult = {
        outcome: { outcome: 'selected', optionId: 'allow_once' },
      };
      mockUserConfirmation.mockResolvedValue(mockResult);

      const params = createMockParams();
      const result =
        await acpSessionHandlers.handleSessionRequestPermission(params);

      expect(result).toEqual(mockResult);
      expect(mockUserConfirmation).toHaveBeenCalledWith(params);
    });

    it('should validate required parameters', async () => {
      await expect(
        acpSessionHandlers.handleSessionRequestPermission({} as any)
      ).rejects.toThrow(JsonRpcError);

      await expect(
        acpSessionHandlers.handleSessionRequestPermission({
          sessionId: 'test-session',
          toolCall: undefined,
        } as any)
      ).rejects.toThrow(JsonRpcError);
    });
  });
});
