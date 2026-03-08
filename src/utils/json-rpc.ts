/**
 * JSON-RPC 2.0 Message Serialization and Deserialization Utilities
 * Handles parsing, validation, and serialization of JSON-RPC messages
 */

import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcMessage,
  JsonRpcError,
  JsonRpcErrorCode
} from '../types/json-rpc';

/**
 * Serializes a JSON-RPC message to a string
 */
export function serializeMessage(message: JsonRpcMessage): string {
  return JSON.stringify(message);
}

/**
 * Deserializes a JSON string to a JSON-RPC message
 * Validates the message structure and returns appropriate errors
 */
export function deserializeMessage(data: string): JsonRpcMessage | JsonRpcError {
  try {
    const parsed = JSON.parse(data);
    
    // Validate basic JSON-RPC structure
    if (!parsed || typeof parsed !== 'object') {
      return createError(JsonRpcErrorCode.INVALID_REQUEST, 'Invalid JSON-RPC message structure');
    }
    
    if (parsed.jsonrpc !== '2.0') {
      return createError(JsonRpcErrorCode.INVALID_REQUEST, 'Invalid JSON-RPC version');
    }
    
    // Validate message type and structure
    if (isRequest(parsed)) {
      return validateRequest(parsed);
    } else if (isResponse(parsed)) {
      return validateResponse(parsed);
    } else if (isNotification(parsed)) {
      return validateNotification(parsed);
    } else {
      return createError(JsonRpcErrorCode.INVALID_REQUEST, 'Unknown JSON-RPC message type');
    }
    
  } catch (error) {
    return createError(JsonRpcErrorCode.PARSE_ERROR, 'Parse error');
  }
}

/**
 * Creates a JSON-RPC request message
 */
export function createRequest(method: string, params?: any, id?: string | number): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    method,
    params,
    id: id ?? generateId()
  };
}

/**
 * Creates a JSON-RPC response message
 */
export function createResponse(result: any, id: string | number | null): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    result,
    id
  };
}

/**
 * Creates a JSON-RPC error response message
 */
export function createErrorResponse(error: JsonRpcError, id: string | number | null): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    error,
    id
  };
}

/**
 * Creates a JSON-RPC notification message
 */
export function createNotification(method: string, params?: any): JsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method,
    params
  };
}

/**
 * Creates a JSON-RPC error object
 */
export function createError(code: number, message: string, data?: any): JsonRpcError {
  return {
    code,
    message,
    data
  };
}

/**
 * Type guards and validation functions
 */

function isRequest(obj: any): obj is JsonRpcRequest {
  return obj.method && typeof obj.method === 'string' && 
         (obj.id !== undefined && (typeof obj.id === 'string' || typeof obj.id === 'number'));
}

function isResponse(obj: any): obj is JsonRpcResponse {
  return (obj.result !== undefined || obj.error !== undefined) &&
         (obj.id !== undefined);
}

function isNotification(obj: any): obj is JsonRpcNotification {
  return obj.method && typeof obj.method === 'string' && obj.id === undefined;
}

function validateRequest(obj: any): JsonRpcRequest | JsonRpcError {
  if (!obj.method || typeof obj.method !== 'string') {
    return createError(JsonRpcErrorCode.INVALID_REQUEST, 'Missing or invalid method');
  }
  
  if (obj.id === undefined || (typeof obj.id !== 'string' && typeof obj.id !== 'number')) {
    return createError(JsonRpcErrorCode.INVALID_REQUEST, 'Missing or invalid id');
  }
  
  return obj as JsonRpcRequest;
}

function validateResponse(obj: any): JsonRpcResponse | JsonRpcError {
  if (obj.result === undefined && obj.error === undefined) {
    return createError(JsonRpcErrorCode.INVALID_REQUEST, 'Response must have either result or error');
  }
  
  if (obj.result !== undefined && obj.error !== undefined) {
    return createError(JsonRpcErrorCode.INVALID_REQUEST, 'Response cannot have both result and error');
  }
  
  if (obj.error && !isValidError(obj.error)) {
    return createError(JsonRpcErrorCode.INVALID_REQUEST, 'Invalid error object');
  }
  
  return obj as JsonRpcResponse;
}

function validateNotification(obj: any): JsonRpcNotification | JsonRpcError {
  if (!obj.method || typeof obj.method !== 'string') {
    return createError(JsonRpcErrorCode.INVALID_REQUEST, 'Missing or invalid method');
  }
  
  return obj as JsonRpcNotification;
}

function isValidError(error: any): boolean {
  return error && 
         typeof error.code === 'number' && 
         typeof error.message === 'string';
}

/**
 * Generates a unique ID for requests
 */
function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * Utility functions for working with JSON-RPC messages
 */

export function isRequestMessage(message: JsonRpcMessage): message is JsonRpcRequest {
  return 'method' in message && 'id' in message;
}

export function isResponseMessage(message: JsonRpcMessage): message is JsonRpcResponse {
  return ('result' in message || 'error' in message) && 'id' in message;
}

export function isNotificationMessage(message: JsonRpcMessage): message is JsonRpcNotification {
  return 'method' in message && !('id' in message);
}

export function isErrorMessage(message: JsonRpcMessage): message is JsonRpcResponse {
  return isResponseMessage(message) && 'error' in message && message.error !== undefined;
}

export function isSuccessMessage(message: JsonRpcMessage): message is JsonRpcResponse {
  return isResponseMessage(message) && 'result' in message && message.result !== undefined;
}