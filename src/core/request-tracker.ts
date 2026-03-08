/**
 * Request/Response Correlation Tracker
 * Manages pending requests and their timeouts for JSON-RPC communication
 */

import { JsonRpcError, JsonRpcErrorCode } from '../types/json-rpc';
import { createError } from '../utils/json-rpc';

export interface PendingRequest {
  id: string | number;
  method: string;
  timestamp: number;
  timeout?: number;
  resolve: (result: any) => void;
  reject: (error: JsonRpcError) => void;
  timeoutHandle?: NodeJS.Timeout;
}

/**
 * Tracks pending requests and handles timeouts
 */
export class RequestTracker {
  private pendingRequests = new Map<string | number, PendingRequest>();
  private defaultTimeout: number;
  
  constructor(defaultTimeout: number = 30000) { // 30 seconds default
    this.defaultTimeout = defaultTimeout;
  }
  
  /**
   * Track a new request
   */
  trackRequest(
    id: string | number,
    method: string,
    resolve: (result: any) => void,
    reject: (error: JsonRpcError) => void,
    timeout?: number
  ): void {
    // Remove any existing request with the same ID
    this.removeRequest(id);
    
    const actualTimeout = timeout ?? this.defaultTimeout;
    const request: PendingRequest = {
      id,
      method,
      timestamp: Date.now(),
      timeout: actualTimeout,
      resolve,
      reject
    };
    
    // Set up timeout if specified
    if (actualTimeout > 0) {
      request.timeoutHandle = setTimeout(() => {
        this.handleTimeout(id);
      }, actualTimeout);
    }
    
    this.pendingRequests.set(id, request);
  }
  
  /**
   * Handle a response for a tracked request
   */
  handleResponse(id: string | number, result: any, error?: JsonRpcError): boolean {
    const request = this.pendingRequests.get(id);
    if (!request) {
      return false; // Request not found or already handled
    }
    
    // Clear timeout
    if (request.timeoutHandle) {
      clearTimeout(request.timeoutHandle);
    }
    
    // Remove from tracking
    this.pendingRequests.delete(id);
    
    // Resolve or reject the promise
    if (error) {
      request.reject(error);
    } else {
      request.resolve(result);
    }
    
    return true;
  }
  
  /**
   * Remove a request from tracking (e.g., for cancellation)
   */
  removeRequest(id: string | number): boolean {
    const request = this.pendingRequests.get(id);
    if (!request) {
      return false;
    }
    
    // Clear timeout
    if (request.timeoutHandle) {
      clearTimeout(request.timeoutHandle);
    }
    
    // Remove from tracking
    this.pendingRequests.delete(id);
    
    // Reject with cancellation error
    request.reject(createError(JsonRpcErrorCode.INTERNAL_ERROR, 'Request cancelled'));
    
    return true;
  }
  
  /**
   * Handle request timeout
   */
  private handleTimeout(id: string | number): void {
    const request = this.pendingRequests.get(id);
    if (!request) {
      return; // Already handled
    }
    
    // Remove from tracking
    this.pendingRequests.delete(id);
    
    // Reject with timeout error
    request.reject(createError(
      JsonRpcErrorCode.INTERNAL_ERROR,
      `Request timeout after ${request.timeout}ms: ${request.method}`
    ));
  }
  
  /**
   * Get information about a pending request
   */
  getRequest(id: string | number): PendingRequest | undefined {
    return this.pendingRequests.get(id);
  }
  
  /**
   * Get all pending request IDs
   */
  getPendingRequestIds(): (string | number)[] {
    return Array.from(this.pendingRequests.keys());
  }
  
  /**
   * Get count of pending requests
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }
  
  /**
   * Get pending requests by method
   */
  getPendingByMethod(method: string): PendingRequest[] {
    return Array.from(this.pendingRequests.values())
      .filter(request => request.method === method);
  }
  
  /**
   * Cancel all pending requests
   */
  cancelAllRequests(): void {
    for (const [id] of this.pendingRequests) {
      this.removeRequest(id);
    }
  }
  
  /**
   * Cancel requests older than specified age (in milliseconds)
   */
  cancelOldRequests(maxAge: number): number {
    const now = Date.now();
    const toCancel: (string | number)[] = [];
    
    for (const [id, request] of this.pendingRequests) {
      if (now - request.timestamp > maxAge) {
        toCancel.push(id);
      }
    }
    
    for (const id of toCancel) {
      this.removeRequest(id);
    }
    
    return toCancel.length;
  }
  
  /**
   * Get statistics about pending requests
   */
  getStats(): {
    totalPending: number;
    oldestRequest?: {
      id: string | number;
      method: string;
      age: number;
    };
    methodCounts: Record<string, number>;
  } {
    const now = Date.now();
    const methodCounts: Record<string, number> = {};
    let oldestRequest: { id: string | number; method: string; age: number } | undefined;
    
    for (const [id, request] of this.pendingRequests) {
      // Count by method
      methodCounts[request.method] = (methodCounts[request.method] || 0) + 1;
      
      // Track oldest request
      const age = now - request.timestamp;
      if (!oldestRequest || age > oldestRequest.age) {
        oldestRequest = { id, method: request.method, age };
      }
    }
    
    return {
      totalPending: this.pendingRequests.size,
      oldestRequest,
      methodCounts
    };
  }
  
  /**
   * Set default timeout for new requests
   */
  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }
  
  /**
   * Get default timeout
   */
  getDefaultTimeout(): number {
    return this.defaultTimeout;
  }
}