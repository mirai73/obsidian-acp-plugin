/**
 * Connection Error Recovery System
 * Implements automatic reconnection with exponential backoff and graceful error handling
 */

import { errorHandler, ErrorCategory, ACPErrorCode } from './error-handler';

/**
 * Connection state enumeration
 */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  FAILED = 'failed'
}

/**
 * Connection recovery configuration
 */
export interface RecoveryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitterFactor: number;
  timeoutMs: number;
}

/**
 * Connection status information
 */
export interface ConnectionStatus {
  state: ConnectionState;
  lastError?: string;
  retryCount: number;
  nextRetryAt?: Date;
  connectedAt?: Date;
  disconnectedAt?: Date;
}

/**
 * Connection event handlers
 */
export interface ConnectionEventHandlers {
  onStateChange?: (status: ConnectionStatus) => void;
  onConnected?: () => void;
  onDisconnected?: (error?: Error) => void;
  onReconnecting?: (attempt: number, delay: number) => void;
  onReconnectFailed?: (error: Error) => void;
  onMaxRetriesReached?: () => void;
}

/**
 * Connection recovery manager with exponential backoff (Requirements 7.5, 7.6)
 */
export class ConnectionRecovery {
  private config: RecoveryConfig;
  private status: ConnectionStatus;
  private handlers: ConnectionEventHandlers;
  private retryTimer?: NodeJS.Timeout;
  private connectionTimeout?: NodeJS.Timeout;
  private connectFunction?: () => Promise<void>;
  
  constructor(
    config: Partial<RecoveryConfig> = {},
    handlers: ConnectionEventHandlers = {}
  ) {
    this.config = {
      maxRetries: 10,
      initialDelay: 1000, // 1 second
      maxDelay: 30000, // 30 seconds
      backoffMultiplier: 2,
      jitterFactor: 0.1,
      timeoutMs: 10000, // 10 seconds
      ...config
    };
    
    this.handlers = handlers;
    
    this.status = {
      state: ConnectionState.DISCONNECTED,
      retryCount: 0
    };
  }
  
  /**
   * Set the connection function to be called for reconnection attempts
   */
  setConnectFunction(connectFn: () => Promise<void>): void {
    this.connectFunction = connectFn;
  }
  
  /**
   * Attempt to establish connection
   */
  async connect(): Promise<void> {
    if (this.status.state === ConnectionState.CONNECTING || 
        this.status.state === ConnectionState.CONNECTED) {
      return;
    }
    
    this.updateState(ConnectionState.CONNECTING);
    this.clearRetryTimer();
    
    try {
      await this.attemptConnection();
      this.onConnectionSuccess();
    } catch (error) {
      this.onConnectionFailure(error as Error);
    }
  }
  
  /**
   * Disconnect and stop all retry attempts
   */
  disconnect(): void {
    this.clearRetryTimer();
    this.clearConnectionTimeout();
    
    if (this.status.state !== ConnectionState.DISCONNECTED) {
      this.updateState(ConnectionState.DISCONNECTED);
      this.status.disconnectedAt = new Date();
      this.handlers.onDisconnected?.();
    }
  }
  
  /**
   * Handle connection loss and start recovery process
   */
  handleConnectionLoss(error?: Error): void {
    if (this.status.state === ConnectionState.DISCONNECTED) {
      return;
    }
    
    this.status.disconnectedAt = new Date();
    this.status.lastError = error?.message;
    
    // Log the connection loss
    errorHandler.handleError(
      error || new Error('Connection lost'),
      ErrorCategory.CONNECTION,
      { 
        previousState: this.status.state,
        retryCount: this.status.retryCount 
      }
    );
    
    this.handlers.onDisconnected?.(error);
    
    // Start reconnection process if we haven't exceeded max retries
    if (this.status.retryCount < this.config.maxRetries) {
      this.startReconnection();
    } else {
      this.updateState(ConnectionState.FAILED);
      this.handlers.onMaxRetriesReached?.();
    }
  }
  
  /**
   * Reset retry count (call when connection is manually re-established)
   */
  resetRetryCount(): void {
    this.status.retryCount = 0;
    this.status.lastError = undefined;
  }
  
  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return { ...this.status };
  }
  
  /**
   * Update recovery configuration
   */
  updateConfig(config: Partial<RecoveryConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.status.state === ConnectionState.CONNECTED;
  }
  
  /**
   * Check if reconnection is in progress
   */
  isReconnecting(): boolean {
    return this.status.state === ConnectionState.RECONNECTING;
  }
  
  /**
   * Force immediate reconnection attempt
   */
  async forceReconnect(): Promise<void> {
    this.clearRetryTimer();
    this.resetRetryCount();
    await this.connect();
  }
  
  /**
   * Private methods
   */
  
  private async attemptConnection(): Promise<void> {
    if (!this.connectFunction) {
      throw new Error('No connection function provided');
    }
    
    // Set connection timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      this.connectionTimeout = setTimeout(() => {
        reject(errorHandler.createTimeoutError('Connection attempt', this.config.timeoutMs));
      }, this.config.timeoutMs);
    });
    
    try {
      await Promise.race([
        this.connectFunction(),
        timeoutPromise
      ]);
    } finally {
      this.clearConnectionTimeout();
    }
  }
  
  private onConnectionSuccess(): void {
    this.clearRetryTimer();
    this.resetRetryCount();
    this.status.connectedAt = new Date();
    this.status.lastError = undefined;
    
    this.updateState(ConnectionState.CONNECTED);
    this.handlers.onConnected?.();
  }
  
  private onConnectionFailure(error: Error): void {
    this.status.lastError = error.message;
    
    // Log the connection failure
    errorHandler.handleError(error, ErrorCategory.CONNECTION, {
      retryCount: this.status.retryCount,
      maxRetries: this.config.maxRetries
    });
    
    if (this.status.retryCount < this.config.maxRetries) {
      this.startReconnection();
    } else {
      this.updateState(ConnectionState.FAILED);
      this.handlers.onMaxRetriesReached?.();
      this.handlers.onReconnectFailed?.(error);
    }
  }
  
  private startReconnection(): void {
    this.status.retryCount++;
    this.updateState(ConnectionState.RECONNECTING);
    
    const delay = this.calculateBackoffDelay();
    this.status.nextRetryAt = new Date(Date.now() + delay);
    
    this.handlers.onReconnecting?.(this.status.retryCount, delay);
    
    this.retryTimer = setTimeout(() => {
      this.connect().catch(error => {
        // Error is already handled in onConnectionFailure
        console.debug('Reconnection attempt failed:', error.message);
      });
    }, delay);
  }
  
  private calculateBackoffDelay(): number {
    // Exponential backoff with jitter
    const exponentialDelay = Math.min(
      this.config.initialDelay * Math.pow(this.config.backoffMultiplier, this.status.retryCount - 1),
      this.config.maxDelay
    );
    
    // Add jitter to prevent thundering herd
    const jitter = exponentialDelay * this.config.jitterFactor * (Math.random() - 0.5);
    
    return Math.max(0, exponentialDelay + jitter);
  }
  
  private updateState(newState: ConnectionState): void {
    const oldState = this.status.state;
    this.status.state = newState;
    
    if (oldState !== newState) {
      this.handlers.onStateChange?.(this.getStatus());
    }
  }
  
  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.status.nextRetryAt = undefined;
  }
  
  private clearConnectionTimeout(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = undefined;
    }
  }
  
  /**
   * Cleanup resources
   */
  destroy(): void {
    this.clearRetryTimer();
    this.clearConnectionTimeout();
    this.updateState(ConnectionState.DISCONNECTED);
  }
}

/**
 * Connection notification manager for user feedback
 */
export class ConnectionNotificationManager {
  private lastNotificationTime = 0;
  private notificationThrottle = 5000; // 5 seconds
  
  constructor(private showNotification: (message: string, type: 'info' | 'warning' | 'error') => void) {}
  
  /**
   * Handle connection state changes with appropriate user notifications
   */
  handleStateChange(status: ConnectionStatus): void {
    const now = Date.now();
    
    // Throttle notifications to avoid spam
    if (now - this.lastNotificationTime < this.notificationThrottle) {
      return;
    }
    
    switch (status.state) {
      case ConnectionState.CONNECTED:
        if (status.retryCount > 0) {
          this.showNotification('Reconnected to AI assistant', 'info');
        }
        break;
        
      case ConnectionState.RECONNECTING:
        if (status.retryCount === 1) {
          this.showNotification('Connection lost. Attempting to reconnect...', 'warning');
        } else if (status.retryCount % 3 === 0) { // Every 3rd attempt
          this.showNotification(
            `Reconnection attempt ${status.retryCount}/${10}...`, 
            'warning'
          );
        }
        break;
        
      case ConnectionState.FAILED:
        this.showNotification(
          'Failed to reconnect to AI assistant. Please check your settings.',
          'error'
        );
        break;
    }
    
    this.lastNotificationTime = now;
  }
  
  /**
   * Show immediate notification for critical connection issues
   */
  showCriticalError(error: string): void {
    this.showNotification(`Connection error: ${error}`, 'error');
    this.lastNotificationTime = Date.now();
  }
}