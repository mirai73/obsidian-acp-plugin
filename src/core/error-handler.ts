/**
 * Comprehensive Error Handling System
 * Provides centralized error handling, user-friendly messages, and logging
 */

import { JsonRpcError, JsonRpcErrorCode } from '../types/json-rpc';
import { createError } from '../utils/json-rpc';

/**
 * ACP-specific error codes extending JSON-RPC standard codes
 */
export enum ACPErrorCode {
  // Standard JSON-RPC 2.0 errors
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  
  // ACP-specific errors (Requirements 7.1, 7.3)
  FILE_NOT_FOUND = -32001,
  PERMISSION_DENIED = -32002,
  INVALID_PATH = -32003,
  SESSION_NOT_FOUND = -32004,
  CAPABILITY_NOT_SUPPORTED = -32005,
  CONNECTION_FAILED = -32006,
  TIMEOUT_ERROR = -32007,
  AGENT_PROCESS_ERROR = -32008,
  VAULT_BOUNDARY_VIOLATION = -32009,
  FILE_OPERATION_FAILED = -32010
}

/**
 * Error severity levels for logging and user notification
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Structured error information
 */
export interface ErrorInfo {
  code: ACPErrorCode;
  message: string;
  userMessage: string;
  severity: ErrorSeverity;
  context?: Record<string, any>;
  timestamp: Date;
  stack?: string;
}

/**
 * Error categories for better organization
 */
export enum ErrorCategory {
  PROTOCOL = 'protocol',
  FILE_SYSTEM = 'file_system',
  PERMISSION = 'permission',
  CONNECTION = 'connection',
  SESSION = 'session',
  AGENT = 'agent'
}

/**
 * Comprehensive error handler with logging and user-friendly messages
 */
export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorLog: ErrorInfo[] = [];
  private maxLogSize = 1000;
  
  private constructor() {}
  
  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }
  
  /**
   * Create a JSON-RPC error with enhanced information
   */
  createJsonRpcError(
    code: ACPErrorCode,
    message: string,
    context?: Record<string, any>
  ): JsonRpcError {
    const errorInfo = this.getErrorInfo(code, message, context);
    this.logError(errorInfo);
    
    return createError(code, errorInfo.userMessage, {
      originalMessage: message,
      context,
      timestamp: errorInfo.timestamp.toISOString()
    });
  }
  
  /**
   * Handle and log errors with appropriate user messaging
   */
  handleError(
    error: Error | JsonRpcError,
    category: ErrorCategory,
    context?: Record<string, any>
  ): ErrorInfo {
    let errorInfo: ErrorInfo;
    
    if (this.isJsonRpcError(error)) {
      errorInfo = this.getErrorInfo(error.code as ACPErrorCode, error.message, context);
    } else {
      // Convert regular Error to structured ErrorInfo
      const code = this.mapErrorToCode(error, category);
      errorInfo = this.getErrorInfo(code, error.message, context);
      errorInfo.stack = error.stack;
    }
    
    this.logError(errorInfo);
    return errorInfo;
  }
  
  /**
   * Get user-friendly error information
   */
  private getErrorInfo(
    code: ACPErrorCode,
    message: string,
    context?: Record<string, any>
  ): ErrorInfo {
    const errorMapping = this.getErrorMapping();
    const mapping = errorMapping[code] || {
      userMessage: 'An unexpected error occurred',
      severity: ErrorSeverity.MEDIUM
    };
    
    return {
      code,
      message,
      userMessage: mapping.userMessage,
      severity: mapping.severity,
      context,
      timestamp: new Date()
    };
  }
  
  /**
   * Map regular errors to ACP error codes based on category
   */
  private mapErrorToCode(error: Error, category: ErrorCategory): ACPErrorCode {
    const message = error.message.toLowerCase();
    
    switch (category) {
      case ErrorCategory.FILE_SYSTEM:
        if (message.includes('not found') || message.includes('enoent')) {
          return ACPErrorCode.FILE_NOT_FOUND;
        }
        if (message.includes('permission') || message.includes('eacces')) {
          return ACPErrorCode.PERMISSION_DENIED;
        }
        if (message.includes('path') || message.includes('invalid')) {
          return ACPErrorCode.INVALID_PATH;
        }
        return ACPErrorCode.FILE_OPERATION_FAILED;
        
      case ErrorCategory.CONNECTION:
        if (message.includes('timeout')) {
          return ACPErrorCode.TIMEOUT_ERROR;
        }
        return ACPErrorCode.CONNECTION_FAILED;
        
      case ErrorCategory.AGENT:
        return ACPErrorCode.AGENT_PROCESS_ERROR;
        
      case ErrorCategory.SESSION:
        return ACPErrorCode.SESSION_NOT_FOUND;
        
      case ErrorCategory.PERMISSION:
        return ACPErrorCode.PERMISSION_DENIED;
        
      case ErrorCategory.PROTOCOL:
      default:
        return ACPErrorCode.INTERNAL_ERROR;
    }
  }
  
  /**
   * Error code to user message mapping (Requirement 7.2)
   */
  private getErrorMapping(): Record<ACPErrorCode, { userMessage: string; severity: ErrorSeverity }> {
    return {
      [ACPErrorCode.PARSE_ERROR]: {
        userMessage: 'Invalid message format received from AI assistant',
        severity: ErrorSeverity.MEDIUM
      },
      [ACPErrorCode.INVALID_REQUEST]: {
        userMessage: 'AI assistant sent an invalid request',
        severity: ErrorSeverity.MEDIUM
      },
      [ACPErrorCode.METHOD_NOT_FOUND]: {
        userMessage: 'AI assistant requested an unsupported operation',
        severity: ErrorSeverity.LOW
      },
      [ACPErrorCode.INVALID_PARAMS]: {
        userMessage: 'AI assistant provided invalid parameters',
        severity: ErrorSeverity.MEDIUM
      },
      [ACPErrorCode.INTERNAL_ERROR]: {
        userMessage: 'An internal error occurred. Please try again',
        severity: ErrorSeverity.HIGH
      },
      [ACPErrorCode.FILE_NOT_FOUND]: {
        userMessage: 'The requested file could not be found',
        severity: ErrorSeverity.LOW
      },
      [ACPErrorCode.PERMISSION_DENIED]: {
        userMessage: 'Access denied. Check your permission settings',
        severity: ErrorSeverity.MEDIUM
      },
      [ACPErrorCode.INVALID_PATH]: {
        userMessage: 'Invalid file path specified',
        severity: ErrorSeverity.LOW
      },
      [ACPErrorCode.SESSION_NOT_FOUND]: {
        userMessage: 'Chat session not found. Please start a new conversation',
        severity: ErrorSeverity.MEDIUM
      },
      [ACPErrorCode.CAPABILITY_NOT_SUPPORTED]: {
        userMessage: 'This AI assistant does not support the requested feature',
        severity: ErrorSeverity.LOW
      },
      [ACPErrorCode.CONNECTION_FAILED]: {
        userMessage: 'Failed to connect to AI assistant. Check your settings',
        severity: ErrorSeverity.HIGH
      },
      [ACPErrorCode.TIMEOUT_ERROR]: {
        userMessage: 'Request timed out. The AI assistant may be busy',
        severity: ErrorSeverity.MEDIUM
      },
      [ACPErrorCode.AGENT_PROCESS_ERROR]: {
        userMessage: 'AI assistant process encountered an error',
        severity: ErrorSeverity.HIGH
      },
      [ACPErrorCode.VAULT_BOUNDARY_VIOLATION]: {
        userMessage: 'AI assistant attempted to access files outside your vault',
        severity: ErrorSeverity.HIGH
      },
      [ACPErrorCode.FILE_OPERATION_FAILED]: {
        userMessage: 'File operation failed. Check file permissions and disk space',
        severity: ErrorSeverity.MEDIUM
      }
    };
  }
  
  /**
   * Log error with detailed information (Requirement 7.1, 7.4)
   */
  private logError(errorInfo: ErrorInfo): void {
    // Add to internal log
    this.errorLog.push(errorInfo);
    
    // Maintain log size limit
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }
    
    // Log to console with appropriate level
    const logMessage = `[ACP Error] ${errorInfo.code}: ${errorInfo.message}`;
    const contextStr = errorInfo.context ? ` Context: ${JSON.stringify(errorInfo.context)}` : '';
    
    switch (errorInfo.severity) {
      case ErrorSeverity.CRITICAL:
      case ErrorSeverity.HIGH:
        console.error(logMessage + contextStr, errorInfo.stack);
        break;
      case ErrorSeverity.MEDIUM:
        console.warn(logMessage + contextStr);
        break;
      case ErrorSeverity.LOW:
      default:
        console.log(logMessage + contextStr);
        break;
    }
  }
  
  /**
   * Get error logs for debugging (Requirement 7.4)
   */
  getErrorLog(limit?: number): ErrorInfo[] {
    const logs = [...this.errorLog].reverse(); // Most recent first
    return limit ? logs.slice(0, limit) : logs;
  }
  
  /**
   * Clear error log
   */
  clearErrorLog(): void {
    this.errorLog = [];
  }
  
  /**
   * Get error statistics
   */
  getErrorStats(): {
    total: number;
    bySeverity: Record<ErrorSeverity, number>;
    byCode: Record<ACPErrorCode, number>;
    recent: number; // Last hour
  } {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const stats = {
      total: this.errorLog.length,
      bySeverity: {} as Record<ErrorSeverity, number>,
      byCode: {} as Record<ACPErrorCode, number>,
      recent: 0
    };
    
    // Initialize counters
    Object.values(ErrorSeverity).forEach(severity => {
      stats.bySeverity[severity] = 0;
    });
    
    Object.values(ACPErrorCode).forEach(code => {
      if (typeof code === 'number') {
        stats.byCode[code] = 0;
      }
    });
    
    // Count errors
    this.errorLog.forEach(error => {
      stats.bySeverity[error.severity]++;
      stats.byCode[error.code]++;
      
      if (error.timestamp > oneHourAgo) {
        stats.recent++;
      }
    });
    
    return stats;
  }
  
  /**
   * Type guard for JSON-RPC errors
   */
  private isJsonRpcError(error: any): error is JsonRpcError {
    return error && typeof error.code === 'number' && typeof error.message === 'string';
  }
  
  /**
   * Create specific error types for common scenarios
   */
  
  createFileNotFoundError(path: string): JsonRpcError {
    return this.createJsonRpcError(
      ACPErrorCode.FILE_NOT_FOUND,
      `File not found: ${path}`,
      { path }
    );
  }
  
  createPermissionDeniedError(operation: string, resource: string): JsonRpcError {
    return this.createJsonRpcError(
      ACPErrorCode.PERMISSION_DENIED,
      `Permission denied for ${operation} on ${resource}`,
      { operation, resource }
    );
  }
  
  createInvalidPathError(path: string, reason?: string): JsonRpcError {
    return this.createJsonRpcError(
      ACPErrorCode.INVALID_PATH,
      `Invalid path: ${path}${reason ? ` (${reason})` : ''}`,
      { path, reason }
    );
  }
  
  createSessionNotFoundError(sessionId: string): JsonRpcError {
    return this.createJsonRpcError(
      ACPErrorCode.SESSION_NOT_FOUND,
      `Session not found: ${sessionId}`,
      { sessionId }
    );
  }
  
  createConnectionFailedError(reason: string): JsonRpcError {
    return this.createJsonRpcError(
      ACPErrorCode.CONNECTION_FAILED,
      `Connection failed: ${reason}`,
      { reason }
    );
  }
  
  createTimeoutError(operation: string, timeout: number): JsonRpcError {
    return this.createJsonRpcError(
      ACPErrorCode.TIMEOUT_ERROR,
      `Operation timed out: ${operation} (${timeout}ms)`,
      { operation, timeout }
    );
  }
  
  createVaultBoundaryViolationError(path: string): JsonRpcError {
    return this.createJsonRpcError(
      ACPErrorCode.VAULT_BOUNDARY_VIOLATION,
      `Path outside vault boundary: ${path}`,
      { path }
    );
  }
}

/**
 * Global error handler instance
 */
export const errorHandler = ErrorHandler.getInstance();