/**
 * JSON-RPC 2.0 Client
 * Provides a complete JSON-RPC client implementation with bidirectional communication
 */

import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcMessage,
  JsonRpcError,
  JsonRpcErrorCode
} from '../types/json-rpc';

import {
  serializeMessage,
  deserializeMessage,
  createRequest,
  createNotification,
  createError,
  isRequestMessage,
  isResponseMessage,
  isNotificationMessage
} from '../utils/json-rpc';

import { MessageDispatcher, MethodHandler, NotificationHandler } from './message-dispatcher';
import { RequestTracker } from './request-tracker';
import { errorHandler, ErrorCategory } from './error-handler';
import { logger, LogCategory } from './logging-system';
import { ConnectionRecovery, ConnectionState, ConnectionEventHandlers } from './connection-recovery';

export interface JsonRpcClientOptions {
  defaultTimeout?: number;
  maxPendingRequests?: number;
  enableConnectionRecovery?: boolean;
  recoveryConfig?: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
  };
}

export interface MessageTransport {
  send(message: string): void;
  onMessage(handler: (message: string) => void): void;
  onError(handler: (error: Error) => void): void;
  onClose(handler: () => void): void;
  close(): void;
}

/**
 * Complete JSON-RPC 2.0 client with bidirectional communication support
 * Enhanced with comprehensive error handling and connection recovery
 */
export class JsonRpcClient {
  private dispatcher: MessageDispatcher;
  private requestTracker: RequestTracker;
  private transport: MessageTransport | null = null;
  private options: JsonRpcClientOptions;
  private messageHandler?: (message: string) => void;
  private errorHandler?: (error: Error) => void;
  private closeHandler?: () => void;
  private connectionRecovery?: ConnectionRecovery;
  private sessionId?: string;
  
  constructor(options: JsonRpcClientOptions = {}) {
    this.options = {
      defaultTimeout: 600000,
      maxPendingRequests: 100,
      enableConnectionRecovery: true,
      recoveryConfig: {
        maxRetries: 10,
        initialDelay: 1000,
        maxDelay: 30000
      },
      ...options
    };
    
    this.dispatcher = new MessageDispatcher();
    this.requestTracker = new RequestTracker(this.options.defaultTimeout);
    
    // Initialize connection recovery if enabled
    if (this.options.enableConnectionRecovery) {
      this.setupConnectionRecovery();
    }
    
    this.setupMessageHandler();
    
    logger.info(LogCategory.PROTOCOL, 'JSON-RPC client initialized', {
      defaultTimeout: this.options.defaultTimeout,
      maxPendingRequests: this.options.maxPendingRequests,
      connectionRecoveryEnabled: this.options.enableConnectionRecovery
    });
  }
  
  /**
   * Set up the message transport
   */
  setTransport(transport: MessageTransport): void {
    if (this.transport) {
      this.transport.close();
    }
    
    this.transport = transport;
    
    // Set up transport event handlers with enhanced error handling
    this.transport.onMessage(this.messageHandler!);
    this.transport.onError(this.errorHandler || ((error) => {
      const errorInfo = errorHandler.handleError(error, ErrorCategory.CONNECTION, {
        sessionId: this.sessionId,
        transportType: 'stdio'
      });
      
      logger.error(LogCategory.CONNECTION, 'JSON-RPC transport error', {
        error: error.message,
        sessionId: this.sessionId
      }, error);
      
      // Trigger connection recovery if enabled
      if (this.connectionRecovery) {
        this.connectionRecovery.handleConnectionLoss(error);
      }
    }));
    
    this.transport.onClose(this.closeHandler || (() => {
      logger.info(LogCategory.CONNECTION, 'JSON-RPC transport closed', {
        sessionId: this.sessionId
      });
      
      this.handleTransportClose();
      
      // Trigger connection recovery if enabled
      if (this.connectionRecovery) {
        this.connectionRecovery.handleConnectionLoss();
      }
    }));
    
    logger.info(LogCategory.CONNECTION, 'Transport configured', {
      sessionId: this.sessionId
    });
  }
  
  /**
   * Send a request and wait for response
   */
  async sendRequest(method: string, params?: any, timeout?: number): Promise<any> {
    if (!this.transport) {
      const error = errorHandler.createConnectionFailedError('No transport configured');
      logger.error(LogCategory.PROTOCOL, 'Send request failed: no transport', {
        method,
        sessionId: this.sessionId
      });
      throw new Error(error.message);
    }
    
    // Check pending request limit
    if (this.requestTracker.getPendingCount() >= (this.options.maxPendingRequests || 100)) {
      const error = errorHandler.createJsonRpcError(
        JsonRpcErrorCode.INTERNAL_ERROR as number,
        'Too many pending requests',
        { pendingCount: this.requestTracker.getPendingCount(), limit: this.options.maxPendingRequests }
      );
      logger.warn(LogCategory.PROTOCOL, 'Request rejected: too many pending', {
        method,
        pendingCount: this.requestTracker.getPendingCount(),
        sessionId: this.sessionId
      });
      throw new Error(error.message);
    }
    
    const request = createRequest(method, params);
    
    logger.info(LogCategory.PROTOCOL, 'Sending JSON-RPC request', {
      method,
      id: request.id,
      hasParams: !!params,
      sessionId: this.sessionId
    });
    
    return new Promise<any>((resolve, reject) => {
      // Track the request
      this.requestTracker.trackRequest(
        request.id,
        method,
        (result) => {
          logger.info(LogCategory.PROTOCOL, 'Request completed successfully', {
            method,
            id: request.id,
            sessionId: this.sessionId
          });
          resolve(result);
        },
        (error: JsonRpcError) => {
          logger.error(LogCategory.PROTOCOL, 'Request failed with JSON-RPC error', {
            method,
            id: request.id,
            errorCode: error.code,
            errorMessage: error.message,
            sessionId: this.sessionId
          });
          reject(new Error(error.message));
        },
        timeout
      );
      
      // Send the request
      try {
        const message = serializeMessage(request);
        this.transport!.send(message);
        
        logger.trace(LogCategory.PROTOCOL, 'Request message sent', {
          method,
          id: request.id,
          messageLength: message.length,
          sessionId: this.sessionId
        });
      } catch (error) {
        this.requestTracker.removeRequest(request.id);
        
        const errorInfo = errorHandler.handleError(error as Error, ErrorCategory.PROTOCOL, {
          method,
          requestId: request.id,
          sessionId: this.sessionId
        });
        
        logger.error(LogCategory.PROTOCOL, 'Failed to send request message', {
          method,
          id: request.id,
          error: (error as Error).message,
          sessionId: this.sessionId
        }, error as Error);
        
        reject(error);
      }
    });
  }
  
  /**
   * Send a notification (no response expected)
   */
  sendNotification(method: string, params?: any): void {
    if (!this.transport) {
      throw new Error('No transport configured');
    }
    
    const notification = createNotification(method, params);
    const message = serializeMessage(notification);
    this.transport.send(message);
  }
  
  /**
   * Register a method handler for incoming requests
   */
  registerMethod(method: string, handler: MethodHandler): void {
    this.dispatcher.registerMethod(method, handler);
  }
  
  /**
   * Register a notification handler
   */
  registerNotification(method: string, handler: NotificationHandler): void {
    this.dispatcher.registerNotification(method, handler);
  }
  
  /**
   * Unregister a method handler
   */
  unregisterMethod(method: string): void {
    this.dispatcher.unregisterMethod(method);
  }
  
  /**
   * Unregister a notification handler
   */
  unregisterNotification(method: string): void {
    this.dispatcher.unregisterNotification(method);
  }
  
  /**
   * Cancel a pending request
   */
  cancelRequest(id: string | number): boolean {
    return this.requestTracker.removeRequest(id);
  }
  
  /**
   * Cancel all pending requests
   */
  cancelAllRequests(): void {
    this.requestTracker.cancelAllRequests();
  }
  
  /**
   * Get client statistics
   */
  getStats(): {
    pendingRequests: number;
    registeredMethods: string[];
    registeredNotifications: string[];
    requestStats: any;
  } {
    return {
      pendingRequests: this.requestTracker.getPendingCount(),
      registeredMethods: this.dispatcher.getRegisteredMethods(),
      registeredNotifications: this.dispatcher.getRegisteredNotifications(),
      requestStats: this.requestTracker.getStats()
    };
  }
  
  /**
   * Close the client and clean up resources
   */
  close(): void {
    logger.info(LogCategory.PROTOCOL, 'Closing JSON-RPC client', {
      sessionId: this.sessionId
    });
    
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    
    this.requestTracker.cancelAllRequests();
    this.dispatcher.clearAllHandlers();
    
    // Clean up connection recovery
    if (this.connectionRecovery) {
      this.connectionRecovery.destroy();
      this.connectionRecovery = undefined;
    }
    
    logger.info(LogCategory.PROTOCOL, 'JSON-RPC client closed', {
      sessionId: this.sessionId
    });
  }
  
  /**
   * Set up the message handler for incoming messages
   */
  private setupMessageHandler(): void {
    this.messageHandler = async (messageData: string) => {
      try {
        logger.trace(LogCategory.PROTOCOL, 'Received message', {
          messageLength: messageData.length,
          sessionId: this.sessionId
        });
        
        const parsed = deserializeMessage(messageData);
        
        // Check if parsing failed
        if ('code' in parsed && 'message' in parsed) {
          // This is a parse error, log it with enhanced error handling
          const errorInfo = errorHandler.handleError(
            new Error(`Parse error: ${parsed.message}`),
            ErrorCategory.PROTOCOL,
            { rawMessage: messageData.substring(0, 200), sessionId: this.sessionId }
          );
          
          logger.error(LogCategory.PROTOCOL, 'JSON-RPC parse error', {
            errorCode: parsed.code,
            errorMessage: parsed.message,
            sessionId: this.sessionId
          });
          return;
        }
        
        const message = parsed as JsonRpcMessage;
        
        // Log incoming message
        logger.debug(LogCategory.PROTOCOL, 'Processing incoming message', {
          messageType: isResponseMessage(message) ? 'response' : 
                      isRequestMessage(message) ? 'request' : 'notification',
          method: 'method' in message ? message.method : undefined,
          id: 'id' in message ? message.id : undefined,
          sessionId: this.sessionId
        });
        
        if (isResponseMessage(message)) {
          // Handle response
          if (message.id !== null && message.id !== undefined) {
            this.requestTracker.handleResponse(message.id, message.result, message.error);
          }
        } else {
          // Handle request or notification
          const response = await this.dispatcher.dispatch(message);
          
          // Send response if this was a request
          if (response && this.transport) {
            const responseMessage = serializeMessage(response);
            this.transport.send(responseMessage);
            
            logger.debug(LogCategory.PROTOCOL, 'Sent response', {
              requestId: 'id' in message ? message.id : undefined,
              hasError: response.error !== undefined,
              sessionId: this.sessionId
            });
          }
        }
      } catch (error) {
        const errorInfo = errorHandler.handleError(
          error as Error,
          ErrorCategory.PROTOCOL,
          { rawMessage: messageData.substring(0, 200), sessionId: this.sessionId }
        );
        
        logger.error(LogCategory.PROTOCOL, 'Error handling JSON-RPC message', {
          error: (error as Error).message,
          sessionId: this.sessionId
        }, error as Error);
      }
    };
  }
  
  /**
   * Set up connection recovery system
   */
  private setupConnectionRecovery(): void {
    if (!this.options.recoveryConfig) return;
    
    const handlers: ConnectionEventHandlers = {
      onStateChange: (status) => {
        logger.info(LogCategory.CONNECTION, 'Connection state changed', {
          state: status.state,
          retryCount: status.retryCount,
          sessionId: this.sessionId
        });
      },
      
      onConnected: () => {
        logger.info(LogCategory.CONNECTION, 'Connection established', {
          sessionId: this.sessionId
        });
      },
      
      onDisconnected: (error) => {
        logger.warn(LogCategory.CONNECTION, 'Connection lost', {
          error: error?.message,
          sessionId: this.sessionId
        }, error);
      },
      
      onReconnecting: (attempt, delay) => {
        logger.info(LogCategory.CONNECTION, 'Attempting reconnection', {
          attempt,
          delay,
          sessionId: this.sessionId
        });
      },
      
      onReconnectFailed: (error) => {
        logger.error(LogCategory.CONNECTION, 'Reconnection failed', {
          error: error.message,
          sessionId: this.sessionId
        }, error);
      },
      
      onMaxRetriesReached: () => {
        logger.error(LogCategory.CONNECTION, 'Max reconnection attempts reached', {
          sessionId: this.sessionId
        });
      }
    };
    
    this.connectionRecovery = new ConnectionRecovery(this.options.recoveryConfig, handlers);
  }
  
  /**
   * Handle transport close event
   */
  private handleTransportClose(): void {
    // Cancel all pending requests
    this.requestTracker.cancelAllRequests();
    
    logger.info(LogCategory.CONNECTION, 'Transport closed, cancelled pending requests', {
      sessionId: this.sessionId
    });
  }
  
  /**
   * Set session ID for logging context
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
    logger.debug(LogCategory.PROTOCOL, 'Session ID set', { sessionId });
  }
  
  /**
   * Get connection recovery status
   */
  getConnectionStatus(): any {
    return this.connectionRecovery?.getStatus() || null;
  }
  
  /**
   * Force reconnection attempt
   */
  async forceReconnect(): Promise<void> {
    if (this.connectionRecovery) {
      await this.connectionRecovery.forceReconnect();
    }
  }
  
  /**
   * Set error handler for transport errors
   */
  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }
  
  /**
   * Set close handler for transport close
   */
  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }
  
  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.transport !== null;
  }
  
  /**
   * Set default timeout for requests
   */
  setDefaultTimeout(timeout: number): void {
    this.requestTracker.setDefaultTimeout(timeout);
  }
  
  /**
   * Clean up old requests (useful for maintenance)
   */
  cleanupOldRequests(maxAge: number = 300000): number { // 5 minutes default
    return this.requestTracker.cancelOldRequests(maxAge);
  }
}