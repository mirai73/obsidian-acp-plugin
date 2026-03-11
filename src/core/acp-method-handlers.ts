/**
 * ACP Method Handlers
 * Implements ACP protocol method handlers with proper error handling and JSON-RPC error codes
 */

import { FileOperationsHandlerImpl } from './file-operations-handler';
import { PermissionManagerImpl } from './permission-manager';
import { FsReadTextFileParams, FsReadTextFileResult, FsWriteTextFileParams, SessionRequestPermissionParams, SessionRequestPermissionResult } from '../types/acp';

/**
 * JSON-RPC 2.0 Error Codes
 */
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
  CAPABILITY_NOT_SUPPORTED = -32005,
  FILE_TOO_LARGE = -32006,
  INVALID_FILE_TYPE = -32007,
}

/**
 * JSON-RPC Error class
 */
export class JsonRpcError extends Error {
  constructor(
    public code: JsonRpcErrorCode,
    message: string,
    public data?: any
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      data: this.data
    };
  }
}

/**
 * ACP File System Method Handlers
 */
export class ACPFileSystemHandlers {
  constructor(private fileHandler: FileOperationsHandlerImpl) {}

  /**
   * Handle fs/read_text_file ACP method
   */
  async handleFsReadTextFile(params: FsReadTextFileParams): Promise<FsReadTextFileResult> {
    try {
      if (!params || typeof params !== 'object') {
        throw new JsonRpcError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid parameters: expected object with path and sessionId properties'
        );
      }

      if (!params.sessionId || typeof params.sessionId !== 'string') {
        throw new JsonRpcError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid parameters: sessionId must be a non-empty string'
        );
      }

      if (!params.path || typeof params.path !== 'string') {
        throw new JsonRpcError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid parameters: path must be a non-empty string'
        );
      }

      // Call file handler with error mapping
      const result = await this.fileHandler.readTextFile(params.path);
      
      return {
        content: result.content,
        encoding: result.encoding
      };

    } catch (error) {
      // Map file handler errors to JSON-RPC errors
      throw this.mapFileError(error, 'read');
    }
  }

  /**
   * Handle fs/write_text_file ACP method
   */
  async handleFsWriteTextFile(params: FsWriteTextFileParams): Promise<void> {
    try {
      if (!params || typeof params !== 'object') {
        throw new JsonRpcError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid parameters: expected object with path, content, and sessionId properties'
        );
      }

      if (!params.sessionId || typeof params.sessionId !== 'string') {
        throw new JsonRpcError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid parameters: sessionId must be a non-empty string'
        );
      }

      if (!params.path || typeof params.path !== 'string') {
        throw new JsonRpcError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid parameters: path must be a non-empty string'
        );
      }

      if (params.content === undefined || params.content === null) {
        throw new JsonRpcError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid parameters: content is required'
        );
      }

      if (typeof params.content !== 'string') {
        throw new JsonRpcError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid parameters: content must be a string'
        );
      }

      // Validate encoding if provided
      if (params.encoding && typeof params.encoding !== 'string') {
        throw new JsonRpcError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid parameters: encoding must be a string'
        );
      }

      // Call file handler with error mapping
      await this.fileHandler.writeTextFile(params.path, params.content, params.encoding);

    } catch (error) {
      // Map file handler errors to JSON-RPC errors
      throw this.mapFileError(error, 'write');
    }
  }

  /**
   * Map file handler errors to appropriate JSON-RPC errors
   */
  private mapFileError(error: any, operation: 'read' | 'write'): JsonRpcError {
    if (error instanceof JsonRpcError) {
      return error;
    }

    const message = error.message || 'Unknown error';

    // Map common file system errors
    if (message.includes('File not found') || message.includes('could not be found')) {
      return new JsonRpcError(
        JsonRpcErrorCode.FILE_NOT_FOUND,
        `File not found: ${message}`,
        { operation }
      );
    }

    if (message.includes('Permission denied') || message.includes('access denied') || message.includes('Access denied')) {
      return new JsonRpcError(
        JsonRpcErrorCode.PERMISSION_DENIED,
        `Permission denied: ${message}`,
        { operation }
      );
    }

    if (message.includes('outside vault boundaries') || message.includes('outside your vault') || message.includes('Invalid file path')) {
      return new JsonRpcError(
        JsonRpcErrorCode.INVALID_PATH,
        `Invalid path: ${message}`,
        { operation }
      );
    }

    if (message.includes('File too large') || message.includes('Content too large')) {
      return new JsonRpcError(
        JsonRpcErrorCode.FILE_TOO_LARGE,
        `File too large: ${message}`,
        { operation }
      );
    }

    if (message.includes('File type not allowed')) {
      return new JsonRpcError(
        JsonRpcErrorCode.INVALID_FILE_TYPE,
        `Invalid file type: ${message}`,
        { operation }
      );
    }

    if (message.includes('Directory not found')) {
      return new JsonRpcError(
        JsonRpcErrorCode.FILE_NOT_FOUND,
        `Directory not found: ${message}`,
        { operation }
      );
    }

    // Default to internal error for unexpected errors
    return new JsonRpcError(
      JsonRpcErrorCode.INTERNAL_ERROR,
      `Internal error during ${operation} operation: ${message}`,
      { 
        operation,
        originalError: error.name || 'Error',
        stack: error.stack
      }
    );
  }
}

/**
 * ACP Session Method Handlers
 */
export class ACPSessionHandlers {
  constructor(private permissionManager: PermissionManagerImpl) {}

  /**
   * Handle session/request_permission ACP method
   */
  async handleSessionRequestPermission(params: SessionRequestPermissionParams): Promise<SessionRequestPermissionResult> {
    try {
      // Validate parameters
      if (!params || typeof params !== 'object') {
        throw new JsonRpcError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid parameters: expected object with sessionId and options properties'
        );
      }

      if (!params.sessionId || typeof params.sessionId !== 'string') {
        throw new JsonRpcError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid parameters: sessionId must be a non-empty string'
        );
      }

      if (!params.toolCall || typeof params.toolCall !== 'object') {
        throw new JsonRpcError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid parameters: toolCall must be an object'
        );
      }

      if (!params.toolCall.toolCallId || typeof params.toolCall.toolCallId !== 'string') {
        throw new JsonRpcError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid parameters: toolCallId must be a non-empty string'
        );
      }

      if (!params.options || !Array.isArray(params.options) || params.options.length === 0) {
        throw new JsonRpcError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'Invalid parameters: options must be a non-empty array'
        );
      }

      // Validate each option
      for (const option of params.options) {
        if (!option.optionId || !option.name || !option.kind) {
          throw new JsonRpcError(
            JsonRpcErrorCode.INVALID_PARAMS,
            'Invalid parameters: each option must have optionId, name, and kind properties'
          );
        }
      }

      // Request permission through permission manager
      // Extract kind and resource from toolCall if available

      const result = await this.permissionManager.requestPermission(params);

      return result;

    } catch (error) {
      // Map permission errors to JSON-RPC errors
      throw this.mapPermissionError(error);
    }
  }

  /**
   * Map permission manager errors to appropriate JSON-RPC errors
   */
  private mapPermissionError(error: any): JsonRpcError {
    if (error instanceof JsonRpcError) {
      return error;
    }

    const message = error.message || 'Unknown error';

    // Map common permission errors
    if (message.includes('Permission denied') || message.includes('access denied')) {
      return new JsonRpcError(
        JsonRpcErrorCode.PERMISSION_DENIED,
        `Permission denied: ${message}`
      );
    }

    if (message.includes('Invalid operation') || message.includes('Invalid resource')) {
      return new JsonRpcError(
        JsonRpcErrorCode.INVALID_PARAMS,
        `Invalid parameters: ${message}`
      );
    }

    // Default to internal error for unexpected errors
    return new JsonRpcError(
      JsonRpcErrorCode.INTERNAL_ERROR,
      `Internal error during permission request: ${message}`,
      { 
        originalError: error.name || 'Error',
        stack: error.stack
      }
    );
  }
}