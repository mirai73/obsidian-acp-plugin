/**
 * Tests for Agent Process Manager
 */

import { AgentProcessManager, AgentConfig } from '../src/core/agent-process-manager';
import { ChildProcess } from 'child_process';

// Mock child_process
jest.mock('child_process');

describe('AgentProcessManager', () => {
  let processManager: AgentProcessManager;
  let mockProcess: Partial<ChildProcess>;
  
  beforeEach(() => {
    processManager = new AgentProcessManager();
    
    // Create mock process
    mockProcess = {
      pid: 12345,
      killed: false,
      stdout: {
        on: jest.fn(),
        setEncoding: jest.fn()
      } as any,
      stderr: {
        on: jest.fn()
      } as any,
      stdin: {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn()
      } as any,
      on: jest.fn(),
      once: jest.fn(),      
      kill: jest.fn()
    };
    
    // Mock spawn to return our mock process
    const { spawn } = require('child_process');
    spawn.mockReturnValue(mockProcess);
  });
  
  afterEach(async () => {
    // Clear all timers and intervals
    jest.clearAllTimers();
    jest.useRealTimers();
    
    // Force shutdown without waiting
    const runningAgents = processManager.getRunningAgents();
    for (const agentId of runningAgents) {
      processManager.killAgent(agentId);
    }
    
    // Clear process health manually
    (processManager as any).processHealth.clear();
    (processManager as any).processes.clear();
    
    // Stop health monitoring
    if ((processManager as any).healthCheckInterval) {
      clearInterval((processManager as any).healthCheckInterval);
      (processManager as any).healthCheckInterval = undefined;
    }
    
    jest.clearAllMocks();
  });
  
  describe('startAgent', () => {
    it('should start an agent process successfully', async () => {
      jest.useFakeTimers();
      
      const config: AgentConfig = {
        id: 'test-agent',
        name: 'Test Agent',
        command: 'node',
        args: ['test.js'],
        enabled: true
      };
      
      // Mock successful process start
      const startPromise = processManager.startAgent(config);
      
      // Fast-forward past the 1 second delay in spawnProcess
      jest.advanceTimersByTime(1100);
      
      await startPromise;
      
      expect(processManager.isAgentRunning('test-agent')).toBe(true);
      
      const health = processManager.getProcessHealth('test-agent');
      expect(health).toBeDefined();
      expect(health?.status).toBe('running');
      expect(health?.pid).toBe(12345);
      
      jest.useRealTimers();
    });
    
    it('should reject if agent is already running', async () => {
      jest.useFakeTimers();
      
      const config: AgentConfig = {
        id: 'test-agent',
        name: 'Test Agent',
        command: 'node',
        args: ['test.js'],
        enabled: true
      };
      
      // Start first agent
      const startPromise1 = processManager.startAgent(config);
      jest.advanceTimersByTime(1100);
      await startPromise1;
      
      // Try to start same agent again
      await expect(processManager.startAgent(config)).rejects.toThrow(
        'Agent test-agent is already running'
      );
      
      jest.useRealTimers();
    });
    
    it('should reject if agent is disabled', async () => {
      const config: AgentConfig = {
        id: 'test-agent',
        name: 'Test Agent',
        command: 'node',
        args: ['test.js'],
        enabled: false
      };
      
      await expect(processManager.startAgent(config)).rejects.toThrow(
        'Agent test-agent is disabled'
      );
    });
  });
  
  describe('stopAgent', () => {
    it('should stop an agent gracefully', async () => {
      jest.useFakeTimers();
      
      const config: AgentConfig = {
        id: 'test-agent',
        name: 'Test Agent',
        command: 'node',
        args: ['test.js'],
        enabled: true
      };
      
      // Start agent
      const startPromise = processManager.startAgent(config);
      jest.advanceTimersByTime(1100);
      await startPromise;
      
      // Mock process exit when once('exit') is called
      (mockProcess.once as jest.Mock).mockImplementation((event, callback) => {
        if (event === 'exit') {
          setTimeout(() => callback(0, 'SIGTERM'), 10);
        }
      });
      
      const stopPromise = processManager.stopAgent('test-agent');
      jest.advanceTimersByTime(100);
      await stopPromise;
      
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(processManager.isAgentRunning('test-agent')).toBe(false);
      
      jest.useRealTimers();
    });
    
    it('should force kill if graceful shutdown times out', async () => {
      jest.useFakeTimers();
      
      const config: AgentConfig = {
        id: 'test-agent',
        name: 'Test Agent',
        command: 'node',
        args: ['test.js'],
        enabled: true
      };
      
      // Start agent
      const startPromise = processManager.startAgent(config);
      jest.advanceTimersByTime(1100);
      await startPromise;
      
      // Don't mock process exit to simulate timeout - just return mockProcess
      (mockProcess.once as jest.Mock).mockImplementation((event: string, callback: (code: number, signal: string) => void) => {
        // Don't call the callback to simulate timeout
        return mockProcess;
      });
      
      const stopPromise = processManager.stopAgent('test-agent', 100);
      
      // Advance past timeout
      jest.advanceTimersByTime(150);
      
      await expect(stopPromise).rejects.toThrow(
        'Agent test-agent failed to stop gracefully within 100ms'
      );
      
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
      
      jest.useRealTimers();
    });
  });
  
  describe('health monitoring', () => {
    it('should track process health', async () => {
      jest.useFakeTimers();
      
      const config: AgentConfig = {
        id: 'test-agent',
        name: 'Test Agent',
        command: 'node',
        args: ['test.js'],
        enabled: true
      };
      
      let healthCheckCount = 0;
      processManager.on('health-check', () => {
        healthCheckCount++;
      });
      
      // Start agent
      const startPromise = processManager.startAgent(config);
      jest.advanceTimersByTime(1100);
      await startPromise;
      
      const health = processManager.getProcessHealth('test-agent');
      expect(health).toBeDefined();
      expect(health?.status).toBe('running');
      expect(health?.startTime).toBeInstanceOf(Date);
      expect(health?.errorCount).toBe(0);
      expect(health?.restartCount).toBe(0);
      
      jest.useRealTimers();
    });
    
    it('should detect process exit and update health', async () => {
      jest.useFakeTimers();
      
      const config: AgentConfig = {
        id: 'test-agent',
        name: 'Test Agent',
        command: 'node',
        args: ['test.js'],
        enabled: true
      };
      
      // Start agent
      const startPromise = processManager.startAgent(config);
      jest.advanceTimersByTime(1100);
      await startPromise;
      
      // Simulate process exit with error
      const exitHandler = (mockProcess.on as jest.Mock).mock.calls.find(
        call => call[0] === 'exit'
      )?.[1];
      
      if (exitHandler) {
        exitHandler(1, null); // Exit with error code
      }
      
      const health = processManager.getProcessHealth('test-agent');
      expect(health?.status).toBe('error');
      expect(health?.errorCount).toBe(1);
      
      jest.useRealTimers();
    });
  });
  
  describe('restart functionality', () => {
    it('should restart an agent successfully', async () => {
      const config: AgentConfig = {
        id: 'test-agent',
        name: 'Test Agent',
        command: 'node',
        args: ['test.js'],
        enabled: true
      };
      
      // Manually set up a stopped agent with restart count
      const health = {
        status: 'stopped' as const,
        errorCount: 0,
        restartCount: 0
      };
      
      (processManager as any).processHealth.set('test-agent', health);
      
      // Mock the spawn to return immediately for restart
      const { spawn } = require('child_process');
      spawn.mockReturnValue(mockProcess);
      
      // Use real timers but with a shorter delay for testing
      const originalRestartDelay = (processManager as any).restartDelayMs;
      (processManager as any).restartDelayMs = 10; // Very short delay for testing
      
      try {
        await processManager.restartAgent('test-agent', config);
        
        expect(processManager.isAgentRunning('test-agent')).toBe(true);
        
        const updatedHealth = processManager.getProcessHealth('test-agent');
        expect(updatedHealth?.restartCount).toBe(1);
      } finally {
        // Restore original delay
        (processManager as any).restartDelayMs = originalRestartDelay;
      }
    }, 15000);
    
    it('should reject restart if max attempts exceeded', async () => {
      const config: AgentConfig = {
        id: 'test-agent',
        name: 'Test Agent',
        command: 'node',
        args: ['test.js'],
        enabled: true
      };
      
      // Manually set restart count to max
      const health = {
        status: 'stopped' as const,
        errorCount: 0,
        restartCount: 3 // Max attempts
      };
      
      (processManager as any).processHealth.set('test-agent', health);
      
      await expect(processManager.restartAgent('test-agent', config)).rejects.toThrow(
        'Agent test-agent has exceeded maximum restart attempts (3)'
      );
    });
  });
  
  describe('shutdown', () => {
    it('should shutdown all agents', async () => {
      jest.useFakeTimers();
      
      const config1: AgentConfig = {
        id: 'agent-1',
        name: 'Agent 1',
        command: 'node',
        args: ['test1.js'],
        enabled: true
      };
      
      const config2: AgentConfig = {
        id: 'agent-2',
        name: 'Agent 2',
        command: 'node',
        args: ['test2.js'],
        enabled: true
      };
      
      // Start both agents
      const start1Promise = processManager.startAgent(config1);
      const start2Promise = processManager.startAgent(config2);
      jest.advanceTimersByTime(1100);
      await Promise.all([start1Promise, start2Promise]);
      
      expect(processManager.getRunningAgents()).toHaveLength(2);
      
      // Mock process exits
      (mockProcess.once as jest.Mock).mockImplementation((event: string, callback: (code: number, signal: string) => void) => {
        if (event === 'exit') {
          setTimeout(() => callback(0, 'SIGTERM'), 10);
        }
        return mockProcess;
      });
      
      const shutdownPromise = processManager.shutdown();
      jest.advanceTimersByTime(1000);
      await shutdownPromise;
      
      expect(processManager.getRunningAgents()).toHaveLength(0);
      
      jest.useRealTimers();
    });
  });
});