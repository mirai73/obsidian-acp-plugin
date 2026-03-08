/**
 * Tests for Stdio Transport
 */

import { StdioTransport } from '../src/core/stdio-transport';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

describe('StdioTransport', () => {
  let mockProcess: Partial<ChildProcess>;
  let mockStdout: EventEmitter;
  let mockStderr: EventEmitter;
  let mockStdin: EventEmitter & { write: jest.Mock; end: jest.Mock; destroyed: boolean };
  let transport: StdioTransport;
  
  beforeEach(() => {
    mockStdout = Object.assign(new EventEmitter(), {
      setEncoding: jest.fn()
    });
    mockStderr = new EventEmitter();
    mockStdin = Object.assign(new EventEmitter(), {
      write: jest.fn().mockReturnValue(true),
      end: jest.fn(),
      destroyed: false
    });
    
    mockProcess = {
      pid: 12345,
      stdout: mockStdout as any,
      stderr: mockStderr as any,
      stdin: mockStdin as any,
      on: jest.fn(),
      kill: jest.fn()
    };
    
    transport = new StdioTransport(mockProcess as ChildProcess, 'test-agent');
  });
  
  afterEach(() => {
    transport.close();
  });
  
  describe('initialization', () => {
    it('should initialize with correct agent ID and connection state', () => {
      expect(transport.getAgentId()).toBe('test-agent');
      expect(transport.isConnected()).toBe(true);
      
      const state = transport.getConnectionState();
      expect(state.agentId).toBe('test-agent');
      expect(state.connected).toBe(true);
      expect(state.pid).toBe(12345);
    });
    
    it('should set up process event handlers', () => {
      expect(mockProcess.on).toHaveBeenCalledWith('exit', expect.any(Function));
      expect(mockProcess.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });
  
  describe('message sending', () => {
    it('should send messages successfully', () => {
      const message = '{"jsonrpc":"2.0","method":"test","id":1}';
      
      transport.send(message);
      
      expect(mockStdin.write).toHaveBeenCalledWith(
        Buffer.from(message + '\n', 'utf8')
      );
      
      const state = transport.getConnectionState();
      expect(state.messagesSent).toBe(1);
      expect(state.bytesSent).toBeGreaterThan(0);
    });
    
    it('should throw error when not connected', () => {
      transport.close();
      
      expect(() => {
        transport.send('test message');
      }).toThrow('Cannot send message: transport is not connected');
    });
    
    it('should throw error when stdin is destroyed', () => {
      mockStdin.destroyed = true;
      
      expect(() => {
        transport.send('test message');
      }).toThrow('Cannot send message: stdin is not available');
    });
    
    it('should throw error for oversized messages', () => {
      const largeMessage = 'x'.repeat(2 * 1024 * 1024); // 2MB
      
      expect(() => {
        transport.send(largeMessage);
      }).toThrow('Message too large');
    });
    
    it('should handle backpressure', () => {
      mockStdin.write.mockReturnValue(false);
      
      const message = 'test message';
      transport.send(message);
      
      // Simulate drain event
      mockStdin.emit('drain');
      
      const state = transport.getConnectionState();
      expect(state.messagesSent).toBe(1);
    });
  });
  
  describe('message receiving', () => {
    it('should process complete messages from stdout', () => {
      const messageHandler = jest.fn();
      transport.onMessage(messageHandler);
      
      const message1 = '{"jsonrpc":"2.0","method":"test1","id":1}';
      const message2 = '{"jsonrpc":"2.0","method":"test2","id":2}';
      
      // Send messages with delimiter
      mockStdout.emit('data', message1 + '\n' + message2 + '\n');
      
      expect(messageHandler).toHaveBeenCalledTimes(2);
      expect(messageHandler).toHaveBeenCalledWith(message1);
      expect(messageHandler).toHaveBeenCalledWith(message2);
      
      const state = transport.getConnectionState();
      expect(state.messagesReceived).toBe(2);
    });
    
    it('should handle partial messages', () => {
      const messageHandler = jest.fn();
      transport.onMessage(messageHandler);
      
      const message = '{"jsonrpc":"2.0","method":"test","id":1}';
      
      // Send message in parts
      mockStdout.emit('data', message.substring(0, 20));
      expect(messageHandler).not.toHaveBeenCalled();
      
      mockStdout.emit('data', message.substring(20) + '\n');
      expect(messageHandler).toHaveBeenCalledWith(message);
    });
    
    it('should skip empty messages', () => {
      const messageHandler = jest.fn();
      transport.onMessage(messageHandler);
      
      mockStdout.emit('data', '\n\n  \n');
      
      expect(messageHandler).not.toHaveBeenCalled();
    });
    
    it('should handle buffer size limit', () => {
      const errorHandler = jest.fn();
      transport.onError(errorHandler);
      
      // Create transport with small buffer limit
      const smallTransport = new StdioTransport(
        mockProcess as ChildProcess,
        'test-agent',
        { maxMessageSize: 100 }
      );
      smallTransport.onError(errorHandler);
      
      // Send data larger than limit
      const largeData = 'x'.repeat(200);
      mockStdout.emit('data', largeData);
      
      expect(errorHandler).toHaveBeenCalled();
      
      smallTransport.close();
    });
  });
  
  describe('connection management', () => {
    it('should handle process exit', () => {
      const closeHandler = jest.fn();
      transport.onClose(closeHandler);
      
      // Simulate process exit
      const exitHandler = (mockProcess.on as jest.Mock).mock.calls.find(
        call => call[0] === 'exit'
      )?.[1];
      
      if (exitHandler) {
        exitHandler(0, 'SIGTERM');
      }
      
      expect(transport.isConnected()).toBe(false);
      expect(closeHandler).toHaveBeenCalled();
    });
    
    it('should handle process errors', () => {
      const errorHandler = jest.fn();
      transport.onError(errorHandler);
      
      // Simulate process error
      const processErrorHandler = (mockProcess.on as jest.Mock).mock.calls.find(
        call => call[0] === 'error'
      )?.[1];
      
      if (processErrorHandler) {
        processErrorHandler(new Error('Process error'));
      }
      
      expect(errorHandler).toHaveBeenCalled();
    });
    
    it('should close gracefully', () => {
      expect(transport.isConnected()).toBe(true);
      
      transport.close();
      
      expect(transport.isConnected()).toBe(false);
      expect(mockStdin.end).toHaveBeenCalled();
    });
  });
  
  describe('statistics', () => {
    it('should track message and byte counts', async () => {
      const messageHandler = jest.fn();
      transport.onMessage(messageHandler);
      
      // Wait a moment for initialization
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Send a message
      const outMessage = '{"jsonrpc":"2.0","method":"out","id":1}';
      transport.send(outMessage);
      
      // Receive a message
      const inMessage = '{"jsonrpc":"2.0","method":"in","id":2}';
      mockStdout.emit('data', inMessage + '\n');
      
      const stats = transport.getStats();
      expect(stats.messagesSent).toBe(1);
      expect(stats.messagesReceived).toBe(1);
      expect(stats.bytesSent).toBeGreaterThan(0);
      expect(stats.bytesReceived).toBeGreaterThan(0);
      expect(stats.uptime).toBeGreaterThanOrEqual(0);
    });
    
    it('should track buffer size', () => {
      // Send partial message
      mockStdout.emit('data', '{"partial":');
      
      const stats = transport.getStats();
      expect(stats.bufferSize).toBeGreaterThan(0);
    });
  });
  
  describe('error handling', () => {
    it('should handle stdout errors', () => {
      const errorHandler = jest.fn();
      transport.onError(errorHandler);
      
      mockStdout.emit('error', new Error('Stdout error'));
      
      expect(errorHandler).toHaveBeenCalled();
    });
    
    it('should handle stdin errors', () => {
      const errorHandler = jest.fn();
      transport.onError(errorHandler);
      
      mockStdin.emit('error', new Error('Stdin error'));
      
      expect(errorHandler).toHaveBeenCalled();
    });
    
    it('should handle message processing errors', () => {
      const errorHandler = jest.fn();
      transport.onError(errorHandler);
      
      // Mock message handler that throws
      const throwingHandler = jest.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      transport.onMessage(throwingHandler);
      
      mockStdout.emit('data', 'test message\n');
      
      expect(errorHandler).toHaveBeenCalled();
    });
  });
});