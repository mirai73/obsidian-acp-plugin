/**
 * JSON-RPC 2.0 Protocol Types
 * Based on the JSON-RPC 2.0 specification
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: any;
  id: string | number;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: any;
  error?: JsonRpcError;
  id: string | number | null;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: any;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export enum JsonRpcErrorCode {
  // Standard JSON-RPC 2.0 errors
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  
  // ACP-specific errors
  FILE_NOT_FOUND = -32001,
  PERMISSION_DENIED = -32002,
  INVALID_PATH = -32003,
  SESSION_NOT_FOUND = -32004,
  CAPABILITY_NOT_SUPPORTED = -32005
}