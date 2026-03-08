/**
 * JSON-RPC 2.0 Protocol Foundation Tests
 * Tests for message serialization, deserialization, and routing
 */

import {
  serializeMessage,
  deserializeMessage,
  createRequest,
  createResponse,
  createNotification,
  createError,
  isRequestMessage,
  isResponseMessage,
  isNotificationMessage
} from '../src/utils/json-rpc';

import { MessageDispatcher } from '../src/core/message-dispatcher';
import { RequestTracker } from '../src/core/request-tracker';
import { JsonRpcErrorCode } from '../src/types/json-rpc';

describe('JSON-RPC Message Serialization', () => {
  test('should serialize request message correctly', () => {
    const request = createRequest('test_method', { param: 'value' }, 'test-id');
    const serialized = serializeMessage(request);
    const parsed = JSON.parse(serialized);
    
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.method).toBe('test_method');
    expect(parsed.params).toEqual({ param: 'value' });
    expect(parsed.id).toBe('test-id');
  });
  
  test('should serialize response message correctly', () => {
    const response = createResponse({ result: 'success' }, 'test-id');
    const serialized = serializeMessage(response);
    const parsed = JSON.parse(serialized);
    
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.result).toEqual({ result: 'success' });
    expect(parsed.id).toBe('test-id');
  });
  
  test('should serialize notification message correctly', () => {
    const notification = createNotification('test_notification', { data: 'value' });
    const serialized = serializeMessage(notification);
    const parsed = JSON.parse(serialized);
    
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.method).toBe('test_notification');
    expect(parsed.params).toEqual({ data: 'value' });
    expect(parsed.id).toBeUndefined();
  });
});

describe('JSON-RPC Message Deserialization', () => {
  test('should deserialize valid request message', () => {
    const messageStr = JSON.stringify({
      jsonrpc: '2.0',
      method: 'test_method',
      params: { param: 'value' },
      id: 'test-id'
    });
    
    const result = deserializeMessage(messageStr);
    expect('code' in result).toBe(false); // Not an error
    
    const message = result as any;
    expect(message.jsonrpc).toBe('2.0');
    expect(message.method).toBe('test_method');
    expect(message.id).toBe('test-id');
  });
  
  test('should return parse error for invalid JSON', () => {
    const result = deserializeMessage('invalid json');
    expect('code' in result).toBe(true);
    expect((result as any).code).toBe(JsonRpcErrorCode.PARSE_ERROR);
  });
  
  test('should return invalid request error for missing jsonrpc version', () => {
    const messageStr = JSON.stringify({
      method: 'test_method',
      id: 'test-id'
    });
    
    const result = deserializeMessage(messageStr);
    expect('code' in result).toBe(true);
    expect((result as any).code).toBe(JsonRpcErrorCode.INVALID_REQUEST);
  });
});

describe('Message Type Guards', () => {
  test('should identify request messages correctly', () => {
    const request = createRequest('test_method', {}, 'test-id');
    expect(isRequestMessage(request)).toBe(true);
    expect(isResponseMessage(request)).toBe(false);
    expect(isNotificationMessage(request)).toBe(false);
  });
  
  test('should identify response messages correctly', () => {
    const response = createResponse({ result: 'success' }, 'test-id');
    expect(isRequestMessage(response)).toBe(false);
    expect(isResponseMessage(response)).toBe(true);
    expect(isNotificationMessage(response)).toBe(false);
  });
  
  test('should identify notification messages correctly', () => {
    const notification = createNotification('test_notification', {});
    expect(isRequestMessage(notification)).toBe(false);
    expect(isResponseMessage(notification)).toBe(false);
    expect(isNotificationMessage(notification)).toBe(true);
  });
});

describe('Message Dispatcher', () => {
  let dispatcher: MessageDispatcher;
  
  beforeEach(() => {
    dispatcher = new MessageDispatcher();
  });
  
  test('should register and call method handlers', async () => {
    const mockHandler = jest.fn().mockResolvedValue({ result: 'success' });
    dispatcher.registerMethod('test_method', mockHandler);
    
    const request = createRequest('test_method', { param: 'value' }, 'test-id');
    const response = await dispatcher.dispatch(request);
    
    expect(mockHandler).toHaveBeenCalledWith({ param: 'value' });
    expect(response?.result).toEqual({ result: 'success' });
    expect(response?.id).toBe('test-id');
  });
  
  test('should return method not found error for unregistered methods', async () => {
    const request = createRequest('unknown_method', {}, 'test-id');
    const response = await dispatcher.dispatch(request);
    
    expect(response?.error?.code).toBe(JsonRpcErrorCode.METHOD_NOT_FOUND);
    expect(response?.id).toBe('test-id');
  });
  
  test('should handle notification messages', async () => {
    const mockHandler = jest.fn();
    dispatcher.registerNotification('test_notification', mockHandler);
    
    const notification = createNotification('test_notification', { data: 'value' });
    const response = await dispatcher.dispatch(notification);
    
    expect(mockHandler).toHaveBeenCalledWith({ data: 'value' });
    expect(response).toBeNull(); // Notifications don't return responses
  });
  
  test('should track and handle response correlation', () => {
    const mockHandler = jest.fn();
    dispatcher.trackRequest('test-id', mockHandler);
    
    const response = createResponse({ result: 'success' }, 'test-id');
    dispatcher.dispatch(response);
    
    expect(mockHandler).toHaveBeenCalledWith({ result: 'success' }, undefined);
  });
});

describe('Request Tracker', () => {
  let tracker: RequestTracker;
  
  beforeEach(() => {
    tracker = new RequestTracker(1000); // 1 second timeout for tests
  });
  
  afterEach(() => {
    tracker.cancelAllRequests();
  });
  
  test('should track and resolve requests', () => {
    const mockResolve = jest.fn();
    const mockReject = jest.fn();
    
    tracker.trackRequest('test-id', 'test_method', mockResolve, mockReject);
    expect(tracker.getPendingCount()).toBe(1);
    
    const handled = tracker.handleResponse('test-id', { result: 'success' });
    expect(handled).toBe(true);
    expect(mockResolve).toHaveBeenCalledWith({ result: 'success' });
    expect(tracker.getPendingCount()).toBe(0);
  });
  
  test('should handle request timeouts', (done) => {
    const mockResolve = jest.fn();
    const mockReject = jest.fn((error) => {
      expect(error.message).toContain('timeout');
      expect(tracker.getPendingCount()).toBe(0);
      done();
    });
    
    tracker.trackRequest('test-id', 'test_method', mockResolve, mockReject, 100);
    expect(tracker.getPendingCount()).toBe(1);
  });
  
  test('should cancel requests', () => {
    const mockResolve = jest.fn();
    const mockReject = jest.fn();
    
    tracker.trackRequest('test-id', 'test_method', mockResolve, mockReject);
    expect(tracker.getPendingCount()).toBe(1);
    
    const cancelled = tracker.removeRequest('test-id');
    expect(cancelled).toBe(true);
    expect(mockReject).toHaveBeenCalled();
    expect(tracker.getPendingCount()).toBe(0);
  });
  
  test('should provide request statistics', () => {
    const mockResolve = jest.fn();
    const mockReject = jest.fn();
    
    tracker.trackRequest('test-id-1', 'method1', mockResolve, mockReject);
    tracker.trackRequest('test-id-2', 'method1', mockResolve, mockReject);
    tracker.trackRequest('test-id-3', 'method2', mockResolve, mockReject);
    
    const stats = tracker.getStats();
    expect(stats.totalPending).toBe(3);
    expect(stats.methodCounts.method1).toBe(2);
    expect(stats.methodCounts.method2).toBe(1);
    expect(stats.oldestRequest).toBeDefined();
  });
});