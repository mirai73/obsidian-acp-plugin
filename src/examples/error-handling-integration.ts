/**
 * Error Handling Integration Example
 * Demonstrates how to use the comprehensive error handling system
 */

import { JsonRpcClient } from '../core/json-rpc-client';
import { FileOperationsHandlerImpl } from '../core/file-operations-handler';
import { errorHandler, ErrorCategory } from '../core/error-handler';
import { logger, LogCategory, LogLevel } from '../core/logging-system';
import { ConnectionRecovery, ConnectionState } from '../core/connection-recovery';
import { ErrorDisplay } from '../ui/error-display';

/**
 * Example integration showing comprehensive error handling
 */
export class ACPPluginWithErrorHandling {
  private jsonRpcClient: JsonRpcClient;
  private fileHandler: FileOperationsHandlerImpl;
  private errorDisplay: ErrorDisplay;
  
  constructor(vaultPath: string) {
    // Configure logging
    logger.configure({
      level: LogLevel.DEBUG,
      enableConsoleOutput: true,
      enableAuditLog: true
    });
    
    // Initialize components with error handling
    this.jsonRpcClient = new JsonRpcClient({
      defaultTimeout: 30000,
      enableConnectionRecovery: true,
      recoveryConfig: {
        maxRetries: 5,
        initialDelay: 1000,
        maxDelay: 30000
      }
    });
    
    this.fileHandler = new FileOperationsHandlerImpl({
      vaultPath,
      allowedExtensions: ['.md', '.txt', '.json'],
      maxFileSize: 10 * 1024 * 1024,
      sessionId: 'example-session',
      userId: 'example-user'
    });
    
    this.errorDisplay = new ErrorDisplay({
      showErrorCodes: false,
      showTimestamps: true,
      enableRetryActions: true
    });
    
    this.setupErrorHandling();
  }
  
  /**
   * Set up comprehensive error handling
   */
  private setupErrorHandling(): void {
    // Handle JSON-RPC client errors
    this.jsonRpcClient.onError((error) => {
      const errorInfo = errorHandler.handleError(error, ErrorCategory.CONNECTION);
      this.displayError(errorInfo);
    });
    
    // Handle connection state changes
    this.jsonRpcClient.onClose(() => {
      logger.info(LogCategory.CONNECTION, 'Connection closed');
      this.updateConnectionStatus(false);
    });
    
    // Set up global error handler for unhandled errors
    process.on('unhandledRejection', (reason, promise) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      const errorInfo = errorHandler.handleError(error, ErrorCategory.PROTOCOL, {
        source: 'unhandledRejection',
        promise: promise.toString()
      });
      
      logger.fatal(LogCategory.PROTOCOL, 'Unhandled promise rejection', {
        reason: String(reason)
      }, error);
      
      this.displayError(errorInfo);
    });
  }
  
  /**
   * Example: Handle file read with comprehensive error handling
   */
  async readFile(path: string): Promise<string | null> {
    try {
      logger.info(LogCategory.FILE_OPS, 'Reading file', { path });
      
      const result = await this.fileHandler.readTextFile(path);
      
      logger.info(LogCategory.FILE_OPS, 'File read successfully', {
        path,
        contentLength: result.content.length
      });
      
      return result.content;
      
    } catch (error) {
      // Error is already handled by FileOperationsHandlerImpl
      // Just display it to the user
      const errorInfo = errorHandler.handleError(error as Error, ErrorCategory.FILE_SYSTEM, {
        operation: 'read',
        path
      });
      
      this.displayError(errorInfo);
      return null;
    }
  }
  
  /**
   * Example: Send JSON-RPC request with error handling
   */
  async sendRequest(method: string, params?: any): Promise<any> {
    try {
      logger.debug(LogCategory.PROTOCOL, 'Sending request', { method });
      
      const result = await this.jsonRpcClient.sendRequest(method, params);
      
      logger.debug(LogCategory.PROTOCOL, 'Request completed', { method });
      return result;
      
    } catch (error) {
      // Error is already handled by JsonRpcClient
      // Display user-friendly message
      const errorInfo = errorHandler.handleError(error as Error, ErrorCategory.PROTOCOL, {
        method,
        params
      });
      
      this.displayError(errorInfo);
      throw error;
    }
  }
  
  /**
   * Display error to user
   */
  private displayError(errorInfo: any): void {
    const errorElement = this.errorDisplay.createErrorMessage(errorInfo);
    
    // In a real implementation, this would be added to the chat interface
    console.log('Error displayed to user:', errorInfo.userMessage);
    
    // You could also emit an event for the UI to handle
    document.dispatchEvent(new CustomEvent('acp-error', {
      detail: { errorInfo, errorElement }
    }));
  }
  
  /**
   * Update connection status display
   */
  private updateConnectionStatus(connected: boolean, error?: string): void {
    const statusElement = this.errorDisplay.createConnectionStatus(
      connected,
      error
    );
    
    // In a real implementation, this would update the UI
    console.log('Connection status:', connected ? 'Connected' : 'Disconnected');
    
    document.dispatchEvent(new CustomEvent('acp-connection-status', {
      detail: { connected, error, statusElement }
    }));
  }
  
  /**
   * Get error statistics for debugging
   */
  getErrorStats(): any {
    return {
      errorHandler: errorHandler.getErrorStats(),
      logger: logger.getLogStats(),
      jsonRpcClient: this.jsonRpcClient.getStats(),
      fileHandler: this.fileHandler.getOperationStats()
    };
  }
  
  /**
   * Get recent logs for debugging
   */
  getRecentLogs(limit: number = 50): any[] {
    return logger.getLogs({ limit });
  }
  
  /**
   * Get audit logs for security review
   */
  getAuditLogs(limit: number = 100): any[] {
    return logger.getAuditLogs({ limit });
  }
  
  /**
   * Clear all logs (for privacy/storage management)
   */
  clearLogs(): void {
    logger.clearAllLogs();
    errorHandler.clearErrorLog();
  }
  
  /**
   * Cleanup resources
   */
  destroy(): void {
    this.jsonRpcClient.close();
    this.clearLogs();
    
    logger.info(LogCategory.PROTOCOL, 'ACP Plugin destroyed');
  }
}

/**
 * Example usage
 */
export function createACPPluginExample(vaultPath: string): ACPPluginWithErrorHandling {
  const plugin = new ACPPluginWithErrorHandling(vaultPath);
  
  // Example error handling setup
  document.addEventListener('acp-error', (event: any) => {
    const { errorInfo, errorElement } = event.detail;
    
    // Add error to chat interface
    const chatContainer = document.querySelector('.chat-messages');
    if (chatContainer) {
      chatContainer.appendChild(errorElement);
    }
  });
  
  document.addEventListener('acp-connection-status', (event: any) => {
    const { connected, statusElement } = event.detail;
    
    // Update connection status in UI
    const statusContainer = document.querySelector('.connection-status-container');
    if (statusContainer) {
      statusContainer.innerHTML = '';
      statusContainer.appendChild(statusElement);
    }
  });
  
  // Example retry handler
  document.addEventListener('error-retry', (event: any) => {
    const { errorInfo } = event.detail;
    
    // Implement retry logic based on error type
    if (errorInfo.message.includes('connection')) {
      (plugin as any).jsonRpcClient?.forceReconnect();
    }
  });
  
  return plugin;
}