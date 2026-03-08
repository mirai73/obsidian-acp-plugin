/**
 * JSON-RPC Message Dispatcher
 * Handles routing of incoming method calls and manages request/response correlation
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
  createErrorResponse,
  createError,
  isRequestMessage,
  isResponseMessage,
  isNotificationMessage
} from '../utils/json-rpc';

export type MethodHandler = (params: any) => Promise<any> | any;
export type NotificationHandler = (params: any) => void;
export type ResponseHandler = (result: any, error?: JsonRpcError) => void;

/**
 * Message dispatcher for handling bidirectional JSON-RPC communication
 */
export class MessageDispatcher {
  private methodHandlers = new Map<string, MethodHandler>();
  private notificationHandlers = new Map<string, NotificationHandler>();
  private pendingRequests = new Map<string | number, ResponseHandler>();
  
  /**
   * Register a method handler for incoming requests
   */
  registerMethod(method: string, handler: MethodHandler): void {
    this.methodHandlers.set(method, handler);
  }
  
  /**
   * Register a notification handler for incoming notifications
   */
  registerNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }
  
  /**
   * Unregister a method handler
   */
  unregisterMethod(method: string): void {
    this.methodHandlers.delete(method);
  }
  
  /**
   * Unregister a notification handler
   */
  unregisterNotification(method: string): void {
    this.notificationHandlers.delete(method);
  }
  
  /**
   * Track a pending request for response correlation
   */
  trackRequest(id: string | number, handler: ResponseHandler): void {
    this.pendingRequests.set(id, handler);
  }
  
  /**
   * Remove a pending request (e.g., on timeout or cancellation)
   */
  removeRequest(id: string | number): void {
    this.pendingRequests.delete(id);
  }
  
  /**
   * Dispatch an incoming JSON-RPC message to the appropriate handler
   */
  async dispatch(message: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    try {
      if (isRequestMessage(message)) {
        return await this.handleRequest(message);
      } else if (isResponseMessage(message)) {
        this.handleResponse(message);
        return null;
      } else if (isNotificationMessage(message)) {
        this.handleNotification(message);
        return null;
      } else {
        // This should not happen if message was properly validated
        return createErrorResponse(
          createError(JsonRpcErrorCode.INVALID_REQUEST, 'Unknown message type'),
          null
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return createErrorResponse(
        createError(JsonRpcErrorCode.INTERNAL_ERROR, errorMessage),
        isRequestMessage(message) ? message.id : null
      );
    }
  }
  
  /**
   * Handle incoming request messages
   */
  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const handler = this.methodHandlers.get(request.method);
    
    if (!handler) {
      return createErrorResponse(
        createError(JsonRpcErrorCode.METHOD_NOT_FOUND, `Method not found: ${request.method}`),
        request.id
      );
    }
    
    try {
      const result = await handler(request.params);
      return {
        jsonrpc: '2.0',
        result,
        id: request.id
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Method execution failed';
      return createErrorResponse(
        createError(JsonRpcErrorCode.INTERNAL_ERROR, errorMessage),
        request.id
      );
    }
  }
  
  /**
   * Handle incoming response messages
   */
  private handleResponse(response: JsonRpcResponse): void {
    if (response.id === null || response.id === undefined) {
      // Response without ID cannot be correlated
      return;
    }
    
    const handler = this.pendingRequests.get(response.id);
    if (handler) {
      this.pendingRequests.delete(response.id);
      handler(response.result, response.error);
    }
    // If no handler found, the response is ignored (could be a late response)
  }
  
  /**
   * Handle incoming notification messages
   */
  private handleNotification(notification: JsonRpcNotification): void {
    const handler = this.notificationHandlers.get(notification.method);
    
    if (handler) {
      try {
        handler(notification.params);
      } catch (error) {
        // Notifications don't return errors, but we can log them
        console.error(`Error handling notification ${notification.method}:`, error);
      }
    }
    // If no handler found, the notification is ignored
  }
  
  /**
   * Get list of registered methods
   */
  getRegisteredMethods(): string[] {
    return Array.from(this.methodHandlers.keys());
  }
  
  /**
   * Get list of registered notification handlers
   */
  getRegisteredNotifications(): string[] {
    return Array.from(this.notificationHandlers.keys());
  }
  
  /**
   * Get count of pending requests
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }
  
  /**
   * Clear all pending requests (useful for cleanup)
   */
  clearPendingRequests(): void {
    // Notify all pending handlers that their requests were cancelled
    for (const [id, handler] of this.pendingRequests) {
      handler(null, createError(JsonRpcErrorCode.INTERNAL_ERROR, 'Request cancelled'));
    }
    this.pendingRequests.clear();
  }
  
  /**
   * Clear all handlers
   */
  clearAllHandlers(): void {
    this.methodHandlers.clear();
    this.notificationHandlers.clear();
    this.clearPendingRequests();
  }
}