/**
 * Session Manager Tests
 * Unit tests for session lifecycle management and conversation handling
 */

import { SessionManagerImpl, SessionManagerOptions } from '../src/core/session-manager';
import { JsonRpcClient } from '../src/core/json-rpc-client';
import { Message, PromptResult, SessionUpdate } from '../src/types/acp';
import { JsonRpcError, JsonRpcErrorCode } from '../src/core/acp-method-handlers';

// Mock JsonRpcClient
jest.mock('../src/core/json-rpc-client');

describe('SessionManager', () => {
  let sessionManager: SessionManagerImpl;
  let mockJsonRpcClient: jest.Mocked<JsonRpcClient>;

  beforeEach(() => {
    const options: SessionManagerOptions = {
      defaultTimeout: 5000,
      maxSessions: 5,
      sessionTimeout: 60000 // 1 minute for testing
    };
    
    sessionManager = new SessionManagerImpl(options);
    
    // Create mock JSON-RPC client
    // Create mock JSON-RPC client
    mockJsonRpcClient = {
      sendRequest: jest.fn(),
      sendNotification: jest.fn(),
      setTransport: jest.fn(),
      registerMethod: jest.fn(),
      registerNotification: jest.fn(),
      unregisterMethod: jest.fn(),
      unregisterNotification: jest.fn(),
      cancelRequest: jest.fn(),
      cancelAllRequests: jest.fn(),
      getStats: jest.fn(),
      close: jest.fn(),
      onError: jest.fn(),
      onClose: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
      setDefaultTimeout: jest.fn(),
      cleanupOldRequests: jest.fn()
    } as any;

    mockJsonRpcClient.sendRequest.mockImplementation((method) => {
      if (method === 'session/new') {
        return Promise.resolve({ 
          sessionId: `session_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          modes: { currentModeId: 'default', availableModes: [] }
        });
      }
      return Promise.resolve({});
    });
    
    sessionManager.setJsonRpcClient(mockJsonRpcClient);
  });

  afterEach(() => {
    sessionManager.shutdown();
    jest.clearAllMocks();
  });

  describe('createSession', () => {
    it('should create a new session with unique ID', async () => {
      const result = await sessionManager.createSession();
      
      expect(result).toHaveProperty('sessionId');
      expect(typeof result.sessionId).toBe('string');
      expect(result.sessionId).toMatch(/^session_\d+_\d+$/);
    });

    it('should create session with capabilities', async () => {
      const cwd = '/test/path';
      const mcpServers: any[] = [];
      mockJsonRpcClient.sendRequest.mockResolvedValue({ 
        sessionId: 'test-session-id',
        modes: { currentModeId: 'default', availableModes: [] },
        models: { currentModelId: 'auto', availableModels: [] }
      });
      
      const result = await sessionManager.createSession(cwd, mcpServers);
      
      expect(result).toHaveProperty('sessionId');
      expect(mockJsonRpcClient.sendRequest).toHaveBeenCalledWith(
        'session/new',
        { cwd, mcpServers }
      );
    });

    it('should handle agent communication failure gracefully', async () => {
      const cwd = '/test/path';
      mockJsonRpcClient.sendRequest.mockRejectedValue(new Error('Connection failed'));
      
      // Should throw error if agent communication fails
      await expect(sessionManager.createSession(cwd)).rejects.toThrow();
    });

    it('should enforce maximum session limit', async () => {
      // Create maximum number of sessions
      for (let i = 0; i < 5; i++) {
        await sessionManager.createSession();
      }
      
      // Attempt to create one more should fail
      await expect(sessionManager.createSession()).rejects.toThrow(JsonRpcError);
    });

    it('should create multiple sessions with unique IDs', async () => {
      const session1 = await sessionManager.createSession();
      const session2 = await sessionManager.createSession();
      
      expect(session1.sessionId).not.toBe(session2.sessionId);
    });
  });

  describe('sendPrompt', () => {
    let sessionId: string;
    let testMessages: Message[];

    beforeEach(async () => {
      const session = await sessionManager.createSession();
      sessionId = session.sessionId;
      
      testMessages = [{
        role: 'user',
        content: [{ type: 'text', text: 'Hello, how are you?' }]
      }];
    });

    it('should send prompt and return result', async () => {
      const mockResult: PromptResult = {
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'I am doing well, thank you!' }]
        },
        stopReason: 'end_turn'
      };
      
      mockJsonRpcClient.sendRequest.mockResolvedValue(mockResult);
      
      const result = await sessionManager.sendPrompt(sessionId, testMessages);
      
      expect(result).toEqual(mockResult);
      expect(mockJsonRpcClient.sendRequest).toHaveBeenCalledWith(
        'session/prompt',
        {
          sessionId,
          prompt: testMessages[0].content
        },
        5000 // default timeout
      );
    });

    it('should throw error for non-existent session', async () => {
      await expect(
        sessionManager.sendPrompt('invalid-session', testMessages)
      ).rejects.toThrow(JsonRpcError);
    });

    it('should throw error when no JSON-RPC client configured', async () => {
      const sessionManagerWithoutClient = new SessionManagerImpl();
      
      await expect(
        sessionManagerWithoutClient.sendPrompt('fake-session', testMessages)
      ).rejects.toThrow(JsonRpcError);
      
      // Clean up the session manager to prevent Jest open handles
      sessionManagerWithoutClient.shutdown();
    });

    it('should add messages to session context', async () => {
      const mockResult: PromptResult = {
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }]
        },
        stopReason: 'end_turn'
      };
      
      mockJsonRpcClient.sendRequest.mockResolvedValue(mockResult);
      
      await sessionManager.sendPrompt(sessionId, testMessages);
      
      const sessionInfo = sessionManager.getSessionInfo(sessionId);
      expect(sessionInfo?.messages).toHaveLength(2); // user message + assistant response
      expect(sessionInfo?.messages[0]).toEqual(testMessages[0]);
      expect(sessionInfo?.messages[1]).toEqual(mockResult.message);
    });

    it('should handle JSON-RPC client errors', async () => {
      mockJsonRpcClient.sendRequest.mockRejectedValue(new Error('Network error'));
      
      await expect(
        sessionManager.sendPrompt(sessionId, testMessages)
      ).rejects.toThrow(JsonRpcError);
    });
  });

  describe('cancelSession', () => {
    let sessionId: string;

    beforeEach(async () => {
      const session = await sessionManager.createSession();
      sessionId = session.sessionId;
    });

    it('should cancel session successfully', async () => {
      mockJsonRpcClient.sendRequest.mockResolvedValue({});
      
      await sessionManager.cancelSession(sessionId);
      
      const sessionInfo = sessionManager.getSessionInfo(sessionId);
      expect(sessionInfo?.status).toBe('cancelled');
    });

    it('should notify agent about cancellation', async () => {
      // Add a pending operation to trigger agent notification
      const testMessages: Message[] = [{
        role: 'user',
        content: [{ type: 'text', text: 'Test' }]
      }];
      
      // Start a prompt (but don't wait for it)
      mockJsonRpcClient.sendRequest.mockImplementation(() => new Promise(() => {})); // Never resolves
      sessionManager.sendPrompt(sessionId, testMessages).catch(() => {}); // Ignore the error
      
      // Now cancel the session
      mockJsonRpcClient.sendRequest.mockResolvedValue({});
      await sessionManager.cancelSession(sessionId);
      
      expect(mockJsonRpcClient.sendRequest).toHaveBeenCalledWith(
        'session/cancel',
        { sessionId }
      );
    });

    it('should throw error for non-existent session', async () => {
      await expect(
        sessionManager.cancelSession('invalid-session')
      ).rejects.toThrow(JsonRpcError);
    });

    it('should handle agent communication failure gracefully', async () => {
      mockJsonRpcClient.sendRequest.mockRejectedValue(new Error('Connection failed'));
      
      // Should still cancel session even if agent communication fails
      await expect(sessionManager.cancelSession(sessionId)).resolves.not.toThrow();
      
      const sessionInfo = sessionManager.getSessionInfo(sessionId);
      expect(sessionInfo?.status).toBe('cancelled');
    });
  });

  describe('updateSession', () => {
    let sessionId: string;

    beforeEach(async () => {
      const session = await sessionManager.createSession();
      sessionId = session.sessionId;
    });

    it('should handle message updates', () => {
      const update: SessionUpdate = {
        type: 'message',
        data: {
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Updated message' }]
          }
        }
      };
      
      sessionManager.updateSession(sessionId, update);
      
      const sessionInfo = sessionManager.getSessionInfo(sessionId);
      expect(sessionInfo?.messages).toHaveLength(1);
      expect(sessionInfo?.messages[0]).toEqual(update.data.message);
    });

    it('should handle status updates', () => {
      const update: SessionUpdate = {
        type: 'status',
        data: { status: 'completed' }
      };
      
      sessionManager.updateSession(sessionId, update);
      
      const sessionInfo = sessionManager.getSessionInfo(sessionId);
      expect(sessionInfo?.status).toBe('completed');
    });

    it('should handle error updates', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const update: SessionUpdate = {
        type: 'error',
        data: { error: 'Something went wrong' }
      };
      
      sessionManager.updateSession(sessionId, update);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        `Session ${sessionId} error:`,
        update.data
      );
      
      consoleSpy.mockRestore();
    });

    it('should handle unknown session gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const update: SessionUpdate = {
        type: 'message',
        data: { message: 'test' }
      };
      
      sessionManager.updateSession('invalid-session', update);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Received update for unknown session: invalid-session'
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('getSessionInfo', () => {
    it('should return session information', async () => {
      const cwd = '/test/path';
      mockJsonRpcClient.sendRequest.mockResolvedValue({ 
        sessionId: 'test-session-id',
        modes: { currentModeId: 'default', availableModes: [] },
        models: { currentModelId: 'auto', availableModels: [] }
      });
      
      const session = await sessionManager.createSession(cwd);
      
      const sessionInfo = sessionManager.getSessionInfo(session.sessionId);
      
      expect(sessionInfo).toBeTruthy();
      expect(sessionInfo?.sessionId).toBe(session.sessionId);
      expect(sessionInfo?.capabilities).toEqual([]);
      expect(sessionInfo?.status).toBe('active');
      expect(sessionInfo?.messages).toEqual([]);
      expect(sessionInfo?.createdAt).toBeInstanceOf(Date);
      expect(sessionInfo?.lastActivity).toBeInstanceOf(Date);
    });

    it('should return null for non-existent session', () => {
      const sessionInfo = sessionManager.getSessionInfo('invalid-session');
      expect(sessionInfo).toBeNull();
    });
  });

  describe('getActiveSessions', () => {
    it('should return only active sessions', async () => {
      const session1 = await sessionManager.createSession();
      const session2 = await sessionManager.createSession();
      
      // Cancel one session
      await sessionManager.cancelSession(session2.sessionId);
      
      const activeSessions = sessionManager.getActiveSessions();
      
      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0].sessionId).toBe(session1.sessionId);
      expect(activeSessions[0].status).toBe('active');
    });

    it('should return empty array when no active sessions', () => {
      const activeSessions = sessionManager.getActiveSessions();
      expect(activeSessions).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return session statistics', async () => {
      await sessionManager.createSession();
      await sessionManager.createSession();
      
      const stats = sessionManager.getStats();
      
      expect(stats.totalSessions).toBe(2);
      expect(stats.activeSessions).toBe(2);
      expect(stats.pendingOperations).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should cancel all active sessions', async () => {
      const session1 = await sessionManager.createSession();
      const session2 = await sessionManager.createSession();
      
      sessionManager.shutdown();
      
      // Sessions should be cancelled (though they might still exist briefly)
      const stats = sessionManager.getStats();
      expect(stats.activeSessions).toBe(0);
    });
  });
});