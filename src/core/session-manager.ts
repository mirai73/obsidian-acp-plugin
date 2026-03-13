/**
 * Session Manager Implementation
 * Manages ACP session lifecycle, conversation context, and session operations
 */

import { SessionManager } from '../interfaces/session-manager';
import {
  Message,
  PromptResult,
  SessionUpdate,
  SessionNewParams,
  SessionNewResult,
  SessionPromptParams,
  SessionCancelParams,
  ContentBlock,
  SessionModeState,
  SessionSetModeParams,
  ToolCall,
  ToolCallUpdate,
  AvailableCommand
} from '../types/acp';
import { JsonRpcClient } from './json-rpc-client';
import { JsonRpcError, JsonRpcErrorCode } from './acp-method-handlers';

export interface SessionManagerOptions {
  defaultTimeout?: number;
  maxSessions?: number;
  sessionTimeout?: number;
  onStreamingChunk?: (sessionId: string, chunk: any) => void;
}

export interface SessionContext {
  sessionId: string; // The agent's session ID - the only one we need
  capabilities: string[];
  messages: Message[];
  createdAt: Date;
  lastActivity: Date;
  status: 'active' | 'cancelled' | 'completed';
  pendingOperations: Set<string>;
  modes?: SessionModeState;
  toolCalls?: Map<string, ToolCall>;
  availableCommands?: AvailableCommand[];
}

/**
 * Session Manager Implementation
 * Handles ACP session lifecycle and conversation management
 */
export class SessionManagerImpl implements SessionManager {
  private sessions: Map<string, SessionContext> = new Map();
  private jsonRpcClient: JsonRpcClient | null = null;
  private options: SessionManagerOptions;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private pendingTimeouts: Set<NodeJS.Timeout> = new Set();

  constructor(options: SessionManagerOptions = {}) {
    this.options = {
      defaultTimeout: 600000,
      maxSessions: 10,
      sessionTimeout: 3600000, // 1 hour
      ...options
    };

    // Set up periodic cleanup
    this.cleanupInterval = setInterval(() => this.cleanupExpiredSessions(), 60000); // Check every minute
  }

  /**
   * Set the JSON-RPC client for communication with agents
   */
  setJsonRpcClient(client: JsonRpcClient): void {
    this.jsonRpcClient = client;
  }

  /**
   * Create a new session with optional capabilities
   */
  async createSession(cwd?: string, mcpServers?: SessionNewParams['mcpServers']): Promise<{sessionId: string}> {
    // Check session limit
    if (this.sessions.size >= (this.options.maxSessions || 10)) {
      throw new JsonRpcError(
        JsonRpcErrorCode.INTERNAL_ERROR,
        'Maximum number of sessions reached'
      );
    }

    if (!this.jsonRpcClient) {
      throw new JsonRpcError(
        JsonRpcErrorCode.INTERNAL_ERROR,
        'No JSON-RPC client configured'
      );
    }

    // Send session/new request to agent first to get the session ID
    try {
      const params: SessionNewParams = { 
        cwd: cwd || process.cwd(),
        mcpServers: mcpServers || []
      };
      const result = await this.jsonRpcClient.sendRequest('session/new', params);
      
      if (!result || !result.sessionId) {
        throw new JsonRpcError(
          JsonRpcErrorCode.INTERNAL_ERROR,
          'Agent did not return a session ID'
        );
      }

      // Create session context using the agent's session ID
      const sessionContext: SessionContext = {
        sessionId: result.sessionId, // Use the agent's session ID
        capabilities: [],
        messages: [],
        createdAt: new Date(),
        lastActivity: new Date(),
        status: 'active',
        pendingOperations: new Set(),
        modes: result.modes,
        toolCalls: new Map()
      };

      // Store session using the agent's session ID
      this.sessions.set(result.sessionId, sessionContext);


      return { sessionId: result.sessionId };

    } catch (error) {
      throw new JsonRpcError(
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Failed to create session with agent: ${error.message || 'Unknown error'}`
      );
    }
  }

  /**
   * Send a prompt to the agent and get a response
   */
  async sendPrompt(sessionId: string, messages: Message[]): Promise<PromptResult> {
    const session = this.getSession(sessionId);
    
    if (!this.jsonRpcClient) {
      throw new JsonRpcError(
        JsonRpcErrorCode.INTERNAL_ERROR,
        'No JSON-RPC client configured'
      );
    }

    // Update session activity
    session.lastActivity = new Date();

    // Add messages to session context
    session.messages.push(...messages);

    // Generate operation ID for tracking
    const operationId = this.generateOperationId();
    session.pendingOperations.add(operationId);

    try {
      // Convert messages to prompt format (flatten all content blocks)
      const promptContent: ContentBlock[] = [];
      for (const message of messages) {
        promptContent.push(...message.content);
      }

      // Send prompt to agent
      const params: SessionPromptParams = {
        sessionId,
        prompt: promptContent
      };

      const result = await this.jsonRpcClient.sendRequest(
        'session/prompt',
        params,
        this.options.defaultTimeout
      );

      
      // Add agent response to session context
      if (result && result.message) {
        const lastMsg = session.messages[session.messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          // Replace accumulated streaming message with final result
          session.messages[session.messages.length - 1] = result.message;
        } else {
          session.messages.push(result.message);
        }
      }

      // Remove operation from pending
      session.pendingOperations.delete(operationId);

      return result as PromptResult;

    } catch (error) {
      // Remove operation from pending
      session.pendingOperations.delete(operationId);

      // Map errors appropriately
      if (error instanceof JsonRpcError) {
        throw error;
      }

      throw new JsonRpcError(
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Failed to send prompt: ${error.message || 'Unknown error'}`
      );
    }
  }

  /**
   * Cancel a session and all its pending operations
   */
  async cancelSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);

    // Mark session as cancelled
    session.status = 'cancelled';
    session.lastActivity = new Date();

    // If we have pending operations and a JSON-RPC client, notify the agent
    if (session.pendingOperations.size > 0 && this.jsonRpcClient) {
      try {
        const params: SessionCancelParams = { sessionId };
        await this.jsonRpcClient.sendRequest('session/cancel', params);
      } catch (error) {
        console.warn('Failed to notify agent about session cancellation:', error);
      }
    }

    // Clear pending operations
    session.pendingOperations.clear();

    // Remove session after a short delay to allow for cleanup
    const timeout = setTimeout(() => {
      this.sessions.delete(sessionId);
      this.pendingTimeouts.delete(timeout);
    }, 1000);
    this.pendingTimeouts.add(timeout);
  }

  /**
   * Update session with status or message updates
   */
  updateSession(sessionId: string, update: SessionUpdate): void {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      console.warn(`Received update for unknown session: ${sessionId}`);
      return;
    }

    // Update session activity
    session.lastActivity = new Date();

    // Handle different update types
    switch (update.type) {
      case 'message':
        if (update.data && update.data.message) {
          session.messages.push(update.data.message);
        }
        break;

      case 'status':
        if (update.data && update.data.status) {
          session.status = update.data.status;
        }
        break;

      case 'error':
        console.error(`Session ${sessionId} error:`, update.data);
        break;

      default:
        console.warn(`Unknown session update type: ${update.type}`);
    }
  }

  /**
   * Handle streaming updates from session/update notifications
   */
  handleStreamingUpdate(params: any): void {
    if (!params || !params.sessionId) {
      console.warn('Received session update without sessionId:', params);
      return;
    }

    const { sessionId, update } = params;
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      console.warn(`Received streaming update for unknown session: ${sessionId}`);
      return;
    }

    // Update session activity
    session.lastActivity = new Date();

    // Handle agent_message_chunk for streaming responses
    if (update && update.sessionUpdate === 'agent_message_chunk' && update.content) {
      // Accumulate in session history
      let lastMsg = session.messages[session.messages.length - 1];
      if (!lastMsg || lastMsg.role !== 'assistant') {
        lastMsg = { role: 'assistant', content: [] };
        session.messages.push(lastMsg);
      }

      // Append chunk to the last assistant message
      if (update.content.type === 'text' && update.content.text) {
        const lastBlock = lastMsg.content[lastMsg.content.length - 1];
        if (lastBlock && lastBlock.type === 'text') {
          lastBlock.text += update.content.text;
        } else {
          lastMsg.content.push({ type: 'text', text: update.content.text });
        }
      } else {
        lastMsg.content.push(update.content);
      }

      // Forward the chunk to the UI callback if available
      if (this.options.onStreamingChunk) {
        this.options.onStreamingChunk(sessionId, update.content);
      }
      
      console.debug('Received streaming chunk (accumulated)');
    } else if (update && update.sessionUpdate === 'current_mode_update') {
      // Handle mode update
      if (session.modes) {
        session.modes.currentModeId = update.modeId;
      } else {
        session.modes = {
          currentModeId: update.modeId,
          availableModes: []
        };
      }
      console.debug('Received mode update:', {
        sessionId,
        modeId: update.modeId
      });
      // Optionally notify the UI about mode update
      if (this.options.onStreamingChunk) {
        this.options.onStreamingChunk(sessionId, { type: 'mode', modeId: update.modeId });
      }
    } else if (update && update.sessionUpdate === 'tool_call') {
      console.log('Received tool_call:', update);
      // Create new tool call
      if (!session.toolCalls) {
        session.toolCalls = new Map();
      }
      const toolCall: ToolCall = {
        toolCallId: update.toolCallId,
        title: update.title,
        kind: update.kind,
        status: update.status || 'pending',
        content: update.content,
        locations: update.locations,
        rawInput: update.rawInput,
        rawOutput: update.rawOutput
      };
      session.toolCalls.set(update.toolCallId, toolCall);
      
      // Notify UI
      if (this.options.onStreamingChunk) {
        this.options.onStreamingChunk(sessionId, { 
          type: 'tool_call', 
          ...toolCall 
        });
      }
      console.debug('Received tool_call:', update.toolCallId);
    } else if (update && update.sessionUpdate === 'tool_call_update') {
      console.log('Received tool_call_update:', update);
      // Update existing tool call
      if (session.toolCalls && session.toolCalls.has(update.toolCallId)) {
        const existingCall = session.toolCalls.get(update.toolCallId)!;
        // Merge updates
        if (update.title !== undefined) existingCall.title = update.title;
        if (update.kind !== undefined) existingCall.kind = update.kind;
        if (update.status !== undefined) existingCall.status = update.status;
        if (update.content !== undefined) {
          existingCall.content = existingCall.content || [];
          existingCall.content.push(...update.content);
        }
        if (update.locations !== undefined) existingCall.locations = update.locations;
        if (update.rawInput !== undefined) existingCall.rawInput = update.rawInput;
        if (update.rawOutput !== undefined) existingCall.rawOutput = update.rawOutput;
        
        // Notify UI
        if (this.options.onStreamingChunk) {
          this.options.onStreamingChunk(sessionId, { 
            type: 'tool_call_update', 
            ...existingCall,
            // Include the incremental update content if it exists
            updateContent: update.content
          });
        }
        console.debug('Received tool_call_update:', update.toolCallId);
      } else {
        console.warn(`Received tool_call_update for unknown tool call: ${update.toolCallId}`);
      }
    } else if (update && update.sessionUpdate === 'available_commands_update') {
      console.log('Received available_commands_update:', update);
      // Update session context with available commands
      session.availableCommands = update.availableCommands;
      
      // Notify UI
      if (this.options.onStreamingChunk) {
        this.options.onStreamingChunk(sessionId, { 
          type: 'available_commands_update', 
          commands: update.availableCommands 
        });
      }
      console.debug('Received available commands for session:', sessionId);
    } else {
      // Handle other types of session updates
      console.log('Received session update:', {
        sessionId,
        update
      });
    }
  }

  /**
   * Get session information
   */
  getSessionInfo(sessionId: string): SessionContext | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): SessionContext[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active');
  }

  /**
   * Get session statistics
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    pendingOperations: number;
  } {
    const activeSessions = this.getActiveSessions();
    const pendingOperations = activeSessions.reduce(
      (total, session) => total + session.pendingOperations.size,
      0
    );

    return {
      totalSessions: this.sessions.size,
      activeSessions: activeSessions.length,
      pendingOperations
    };
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = new Date();
    const timeout = this.options.sessionTimeout || 3600000;

    for (const [sessionId, session] of this.sessions.entries()) {
      const age = now.getTime() - session.lastActivity.getTime();
      
      if (age > timeout && session.status !== 'active') {
        this.sessions.delete(sessionId);
        console.debug(`Cleaned up expired session: ${sessionId}`);
      }
    }
  }

  /**
   * Set the current mode for a session
   */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    const session = this.getSession(sessionId);
    
    if (!this.jsonRpcClient) {
      throw new JsonRpcError(
        JsonRpcErrorCode.INTERNAL_ERROR,
        'No JSON-RPC client configured'
      );
    }

    try {
      const params: SessionSetModeParams = {
        sessionId,
        modeId
      };
      await this.jsonRpcClient.sendRequest('session/set_mode', params);
      
      if (session.modes) {
        session.modes.currentModeId = modeId;
      }
      
      session.lastActivity = new Date();
    } catch (error) {
      throw new JsonRpcError(
        JsonRpcErrorCode.INTERNAL_ERROR,
        `Failed to set mode: ${error.message || 'Unknown error'}`
      );
    }
  }

  /**
   * Get session or throw error if not found
   */
  private getSession(sessionId: string): SessionContext {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      throw new JsonRpcError(
        JsonRpcErrorCode.SESSION_NOT_FOUND,
        `Session not found: ${sessionId}`
      );
    }

    if (session.status === 'cancelled') {
      throw new JsonRpcError(
        JsonRpcErrorCode.SESSION_NOT_FOUND,
        `Session cancelled: ${sessionId}`
      );
    }

    return session;
  }

  /**
   * Generate unique operation ID
   */
  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Shutdown the session manager and clean up resources
   */
  shutdown(): void {
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Clear all pending timeouts
    for (const timeout of this.pendingTimeouts) {
      clearTimeout(timeout);
    }
    this.pendingTimeouts.clear();

    // Cancel all active sessions
    for (const sessionId of this.sessions.keys()) {
      try {
        const session = this.sessions.get(sessionId);
        if (session && session.status === 'active') {
          // Mark as cancelled without using setTimeout
          session.status = 'cancelled';
          session.pendingOperations.clear();
        }
      } catch (error) {
        console.warn(`Error cancelling session ${sessionId} during shutdown:`, error);
      }
    }

    this.sessions.clear();
  }
}