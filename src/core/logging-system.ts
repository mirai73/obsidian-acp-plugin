/**
 * Comprehensive Logging System
 * Provides debug logging, operation audit logs, and configurable log levels
 */

/**
 * Log levels for filtering and categorization (Requirement 7.4)
 */
export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  FATAL = 5
}

/**
 * Log categories for better organization
 */
export enum LogCategory {
  PROTOCOL = 'protocol',
  FILE_OPS = 'file_ops',
  CONNECTION = 'connection',
  SESSION = 'session',
  PERMISSION = 'permission',
  UI = 'ui',
  AGENT = 'agent',
  AUDIT = 'audit'
}

/**
 * Structured log entry
 */
export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  category: LogCategory;
  message: string;
  context?: Record<string, any>;
  error?: Error;
  sessionId?: string;
  userId?: string;
  operation?: string;
}

/**
 * Audit log entry for security and compliance
 */
export interface AuditLogEntry extends LogEntry {
  category: LogCategory.AUDIT;
  operation: string;
  resource?: string;
  success: boolean;
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level: LogLevel;
  maxEntries: number;
  enableConsoleOutput: boolean;
  enableFileOutput: boolean;
  enableAuditLog: boolean;
  auditLogMaxEntries: number;
  categories: Set<LogCategory>;
}

/**
 * Log output formatter
 */
export interface LogFormatter {
  format(entry: LogEntry): string;
}

/**
 * Default console formatter
 */
export class ConsoleLogFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const level = LogLevel[entry.level].padEnd(5);
    const category = entry.category.padEnd(10);
    const context = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    
    return `[${timestamp}] ${level} [${category}] ${entry.message}${context}`;
  }
}

/**
 * JSON formatter for structured logging
 */
export class JsonLogFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    return JSON.stringify({
      timestamp: entry.timestamp.toISOString(),
      level: LogLevel[entry.level],
      category: entry.category,
      message: entry.message,
      context: entry.context,
      error: entry.error ? {
        name: entry.error.name,
        message: entry.error.message,
        stack: entry.error.stack
      } : undefined,
      sessionId: entry.sessionId,
      userId: entry.userId,
      operation: entry.operation
    });
  }
}

/**
 * Comprehensive logging system with multiple outputs and filtering
 */
export class Logger {
  private static instance: Logger;
  private config: LoggerConfig;
  private logs: LogEntry[] = [];
  private auditLogs: AuditLogEntry[] = [];
  private formatter: LogFormatter;
  
  private constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: LogLevel.INFO,
      maxEntries: 10000,
      enableConsoleOutput: true,
      enableFileOutput: false,
      enableAuditLog: true,
      auditLogMaxEntries: 5000,
      categories: new Set(Object.values(LogCategory)),
      ...config
    };
    
    this.formatter = new ConsoleLogFormatter();
  }
  
  static getInstance(config?: Partial<LoggerConfig>): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(config);
    }
    return Logger.instance;
  }
  
  /**
   * Configure logger settings
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Set log formatter
   */
  setFormatter(formatter: LogFormatter): void {
    this.formatter = formatter;
  }
  
  /**
   * Core logging method
   */
  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    context?: Record<string, any>,
    error?: Error,
    sessionId?: string,
    userId?: string,
    operation?: string
  ): void {
    // Check if logging is enabled for this level and category
    if (level < this.config.level || !this.config.categories.has(category)) {
      return;
    }
    
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      category,
      message,
      context,
      error,
      sessionId,
      userId,
      operation
    };
    
    // Add to log storage
    this.addLogEntry(entry);
    
    // Output to console if enabled
    if (this.config.enableConsoleOutput) {
      this.outputToConsole(entry);
    }
  }
  
  /**
   * Trace level logging (most verbose)
   */
  trace(
    category: LogCategory,
    message: string,
    context?: Record<string, any>,
    sessionId?: string
  ): void {
    this.log(LogLevel.TRACE, category, message, context, undefined, sessionId);
  }
  
  /**
   * Debug level logging
   */
  debug(
    category: LogCategory,
    message: string,
    context?: Record<string, any>,
    sessionId?: string
  ): void {
    this.log(LogLevel.DEBUG, category, message, context, undefined, sessionId);
  }
  
  /**
   * Info level logging
   */
  info(
    category: LogCategory,
    message: string,
    context?: Record<string, any>,
    sessionId?: string
  ): void {
    this.log(LogLevel.INFO, category, message, context, undefined, sessionId);
  }
  
  /**
   * Warning level logging
   */
  warn(
    category: LogCategory,
    message: string,
    context?: Record<string, any>,
    error?: Error,
    sessionId?: string
  ): void {
    this.log(LogLevel.WARN, category, message, context, error, sessionId);
  }
  
  /**
   * Error level logging
   */
  error(
    category: LogCategory,
    message: string,
    context?: Record<string, any>,
    error?: Error,
    sessionId?: string
  ): void {
    this.log(LogLevel.ERROR, category, message, context, error, sessionId);
  }
  
  /**
   * Fatal level logging (most severe)
   */
  fatal(
    category: LogCategory,
    message: string,
    context?: Record<string, any>,
    error?: Error,
    sessionId?: string
  ): void {
    this.log(LogLevel.FATAL, category, message, context, error, sessionId);
  }
  
  /**
   * Audit logging for security and compliance (Requirement 7.1)
   */
  audit(
    operation: string,
    success: boolean,
    resource?: string,
    context?: Record<string, any>,
    sessionId?: string,
    userId?: string
  ): void {
    if (!this.config.enableAuditLog) {
      return;
    }
    
    const auditEntry: AuditLogEntry = {
      timestamp: new Date(),
      level: LogLevel.INFO,
      category: LogCategory.AUDIT,
      message: `${operation} ${success ? 'succeeded' : 'failed'}${resource ? ` for ${resource}` : ''}`,
      context,
      operation,
      resource,
      success,
      sessionId,
      userId
    };
    
    // Add to audit log storage
    this.addAuditLogEntry(auditEntry);
    
    // Also add to regular logs
    this.addLogEntry(auditEntry);
    
    // Output to console if enabled
    if (this.config.enableConsoleOutput) {
      this.outputToConsole(auditEntry);
    }
  }
  
  /**
   * Protocol-specific logging helpers
   */
  
  logProtocolMessage(
    direction: 'incoming' | 'outgoing',
    message: any,
    sessionId?: string
  ): void {
    this.debug(
      LogCategory.PROTOCOL,
      `${direction} JSON-RPC message`,
      { 
        direction,
        method: message.method,
        id: message.id,
        hasParams: !!message.params,
        hasResult: !!message.result,
        hasError: !!message.error
      },
      sessionId
    );
  }
  
  logFileOperation(
    operation: string,
    path: string,
    success: boolean,
    error?: Error,
    sessionId?: string,
    userId?: string
  ): void {
    // Regular log
    const level = success ? LogLevel.INFO : LogLevel.ERROR;
    this.log(
      level,
      LogCategory.FILE_OPS,
      `File ${operation} ${success ? 'succeeded' : 'failed'}: ${path}`,
      { operation, path, success },
      error,
      sessionId,
      userId,
      operation
    );
    
    // Audit log
    this.audit(
      `file_${operation}`,
      success,
      path,
      { operation, path },
      sessionId,
      userId
    );
  }
  
  logConnectionEvent(
    event: string,
    details?: Record<string, any>,
    sessionId?: string
  ): void {
    this.info(
      LogCategory.CONNECTION,
      `Connection ${event}`,
      { event, ...details },
      sessionId
    );
  }
  
  logPermissionCheck(
    operation: string,
    resource: string,
    granted: boolean,
    reason?: string,
    sessionId?: string,
    userId?: string
  ): void {
    // Regular log
    this.info(
      LogCategory.PERMISSION,
      `Permission ${granted ? 'granted' : 'denied'} for ${operation} on ${resource}`,
      { operation, resource, granted, reason },
      sessionId
    );
    
    // Audit log
    this.audit(
      `permission_check`,
      granted,
      resource,
      { operation, resource, reason },
      sessionId,
      userId
    );
  }
  
  /**
   * Log retrieval methods
   */
  
  getLogs(
    filter?: {
      level?: LogLevel;
      category?: LogCategory;
      since?: Date;
      sessionId?: string;
      limit?: number;
    }
  ): LogEntry[] {
    let filtered = [...this.logs];
    
    if (filter) {
      if (filter.level !== undefined) {
        filtered = filtered.filter(log => log.level >= filter.level!);
      }
      
      if (filter.category) {
        filtered = filtered.filter(log => log.category === filter.category);
      }
      
      if (filter.since) {
        filtered = filtered.filter(log => log.timestamp >= filter.since!);
      }
      
      if (filter.sessionId) {
        filtered = filtered.filter(log => log.sessionId === filter.sessionId);
      }
      
      if (filter.limit) {
        filtered = filtered.slice(-filter.limit);
      }
    }
    
    return filtered.reverse(); // Most recent first
  }
  
  getAuditLogs(
    filter?: {
      operation?: string;
      success?: boolean;
      since?: Date;
      sessionId?: string;
      userId?: string;
      limit?: number;
    }
  ): AuditLogEntry[] {
    let filtered = [...this.auditLogs];
    
    if (filter) {
      if (filter.operation) {
        filtered = filtered.filter(log => log.operation === filter.operation);
      }
      
      if (filter.success !== undefined) {
        filtered = filtered.filter(log => log.success === filter.success);
      }
      
      if (filter.since) {
        filtered = filtered.filter(log => log.timestamp >= filter.since!);
      }
      
      if (filter.sessionId) {
        filtered = filtered.filter(log => log.sessionId === filter.sessionId);
      }
      
      if (filter.userId) {
        filtered = filtered.filter(log => log.userId === filter.userId);
      }
      
      if (filter.limit) {
        filtered = filtered.slice(-filter.limit);
      }
    }
    
    return filtered.reverse(); // Most recent first
  }
  
  /**
   * Log statistics
   */
  getLogStats(): {
    totalLogs: number;
    totalAuditLogs: number;
    logsByLevel: Record<string, number>;
    logsByCategory: Record<string, number>;
    recentErrors: number; // Last hour
    recentAuditFailures: number; // Last hour
  } {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const stats = {
      totalLogs: this.logs.length,
      totalAuditLogs: this.auditLogs.length,
      logsByLevel: {} as Record<string, number>,
      logsByCategory: {} as Record<string, number>,
      recentErrors: 0,
      recentAuditFailures: 0
    };
    
    // Initialize counters
    Object.keys(LogLevel).forEach(level => {
      if (isNaN(Number(level))) {
        stats.logsByLevel[level] = 0;
      }
    });
    
    Object.values(LogCategory).forEach(category => {
      stats.logsByCategory[category] = 0;
    });
    
    // Count logs
    this.logs.forEach(log => {
      stats.logsByLevel[LogLevel[log.level]]++;
      stats.logsByCategory[log.category]++;
      
      if (log.level >= LogLevel.ERROR && log.timestamp > oneHourAgo) {
        stats.recentErrors++;
      }
    });
    
    // Count audit failures
    this.auditLogs.forEach(log => {
      if (!log.success && log.timestamp > oneHourAgo) {
        stats.recentAuditFailures++;
      }
    });
    
    return stats;
  }
  
  /**
   * Clear logs
   */
  clearLogs(): void {
    this.logs = [];
  }
  
  clearAuditLogs(): void {
    this.auditLogs = [];
  }
  
  clearAllLogs(): void {
    this.clearLogs();
    this.clearAuditLogs();
  }
  
  /**
   * Private helper methods
   */
  
  private addLogEntry(entry: LogEntry): void {
    this.logs.push(entry);
    
    // Maintain size limit
    if (this.logs.length > this.config.maxEntries) {
      this.logs = this.logs.slice(-this.config.maxEntries);
    }
  }
  
  private addAuditLogEntry(entry: AuditLogEntry): void {
    this.auditLogs.push(entry);
    
    // Maintain size limit
    if (this.auditLogs.length > this.config.auditLogMaxEntries) {
      this.auditLogs = this.auditLogs.slice(-this.config.auditLogMaxEntries);
    }
  }
  
  private outputToConsole(entry: LogEntry): void {
    const formatted = this.formatter.format(entry);
    
    switch (entry.level) {
      case LogLevel.TRACE:
      case LogLevel.DEBUG:
        console.debug(formatted);
        break;
      case LogLevel.INFO:
        console.info(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(formatted);
        if (entry.error) {
          console.error(entry.error);
        }
        break;
    }
  }
}

/**
 * Global logger instance
 */
export const logger = Logger.getInstance();

/**
 * Convenience functions for common logging patterns
 */
export const log = {
  trace: (category: LogCategory, message: string, context?: Record<string, any>, sessionId?: string) =>
    logger.trace(category, message, context, sessionId),
    
  debug: (category: LogCategory, message: string, context?: Record<string, any>, sessionId?: string) =>
    logger.debug(category, message, context, sessionId),
    
  info: (category: LogCategory, message: string, context?: Record<string, any>, sessionId?: string) =>
    logger.info(category, message, context, sessionId),
    
  warn: (category: LogCategory, message: string, context?: Record<string, any>, error?: Error, sessionId?: string) =>
    logger.warn(category, message, context, error, sessionId),
    
  error: (category: LogCategory, message: string, context?: Record<string, any>, error?: Error, sessionId?: string) =>
    logger.error(category, message, context, error, sessionId),
    
  fatal: (category: LogCategory, message: string, context?: Record<string, any>, error?: Error, sessionId?: string) =>
    logger.fatal(category, message, context, error, sessionId),
    
  audit: (operation: string, success: boolean, resource?: string, context?: Record<string, any>, sessionId?: string, userId?: string) =>
    logger.audit(operation, success, resource, context, sessionId, userId),
    
  protocol: (direction: 'incoming' | 'outgoing', message: any, sessionId?: string) =>
    logger.logProtocolMessage(direction, message, sessionId),
    
  fileOp: (operation: string, path: string, success: boolean, error?: Error, sessionId?: string, userId?: string) =>
    logger.logFileOperation(operation, path, success, error, sessionId, userId),
    
  connection: (event: string, details?: Record<string, any>, sessionId?: string) =>
    logger.logConnectionEvent(event, details, sessionId),
    
  permission: (operation: string, resource: string, granted: boolean, reason?: string, sessionId?: string, userId?: string) =>
    logger.logPermissionCheck(operation, resource, granted, reason, sessionId, userId)
};