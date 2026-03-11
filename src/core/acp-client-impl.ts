/**
 * ACP Client Implementation
 * Main implementation of the ACP client with child process management
 */

import { EventEmitter } from 'events';
import { ACPClient } from '../interfaces/acp-client';
import { SessionManager } from '../interfaces/session-manager';
import { AgentProcessManager, AgentConfig, ProcessHealth } from './agent-process-manager';
import { StdioTransport, ConnectionState } from './stdio-transport';
import { JsonRpcClient } from './json-rpc-client';
import { FileOperationsHandlerImpl, FileOperationsConfig } from './file-operations-handler';
import { ACPFileSystemHandlers, JsonRpcError } from './acp-method-handlers';
import {
  FsReadTextFileParams,
  FsReadTextFileResult,
  FsWriteTextFileParams,
  SessionRequestPermissionParams,
  SessionRequestPermissionResult,
  SessionUpdateParams,
  ConnectionStatus,
  InitializeParams,
  InitializeResult
} from '../types/acp';

export interface ACPClientOptions {
  healthCheckInterval?: number;
  maxRestartAttempts?: number;
  requestTimeout?: number;
  maxPendingRequests?: number;
  fileOperations?: FileOperationsConfig | null;
}

export interface AgentConnection {
  agentId: string;
  config: AgentConfig;
  processHealth: ProcessHealth;
  connectionState: ConnectionState;
  jsonRpcClient: JsonRpcClient;
  transport: StdioTransport;
  agentCapabilities?: InitializeResult['agentCapabilities'];
}

/**
 * Complete ACP client implementation with process management and stdio communication
 */
export class ACPClientImpl extends EventEmitter implements ACPClient {
  private processManager: AgentProcessManager;
  private connections = new Map<string, AgentConnection>();
  private options: Required<ACPClientOptions>;
  private fileOperationsHandler?: FileOperationsHandlerImpl;
  private acpFileSystemHandlers?: ACPFileSystemHandlers;
  private sessionManager?: SessionManager; // Reference to session manager for streaming updates
  
  // Method handlers - to be implemented by the plugin
  private fsReadTextFileHandler?: (params: FsReadTextFileParams) => Promise<FsReadTextFileResult>;
  private fsWriteTextFileHandler?: (params: FsWriteTextFileParams) => Promise<void>;
  private sessionRequestPermissionHandler?: (params: SessionRequestPermissionParams) => Promise<SessionRequestPermissionResult>;
  private sessionUpdateHandler?: (params: SessionUpdateParams) => void;
  
  constructor(options: ACPClientOptions = {}) {
    super();
    
    const defaultFileOps: FileOperationsConfig = {
      vaultPath: process.cwd(),
      allowedExtensions: ['.md', '.txt', '.json'],
      maxFileSize: 10 * 1024 * 1024,
      createDirectories: true
    };

    this.options = {
      healthCheckInterval: 30000,
      maxRestartAttempts: 3,
      requestTimeout: 5000,
      maxPendingRequests: 100,
      fileOperations: options.fileOperations === null ? null : {
        ...defaultFileOps,
        ...options.fileOperations
      },
      ...options
    } as Required<ACPClientOptions>;
    
    this.processManager = new AgentProcessManager();
    this.setupProcessManagerEvents();
    
    // Only initialize if not explicitly disabled
    if (this.options.fileOperations) {
      this.initializeFileOperations(this.options.fileOperations);
    }
  }
  
  /**
   * Initialize file operations handler
   */
  private initializeFileOperations(config: FileOperationsConfig): void {
    this.fileOperationsHandler = new FileOperationsHandlerImpl(config);
    this.acpFileSystemHandlers = new ACPFileSystemHandlers(this.fileOperationsHandler);
  }
  
  /**
   * Update file operations configuration
   */
  updateFileOperationsConfig(config: Partial<FileOperationsConfig>): void {
    if (this.fileOperationsHandler) {
      this.fileOperationsHandler.updateConfig(config);
    } else if (config.vaultPath) {
      // Initialize if not already done
      this.initializeFileOperations({
        vaultPath: config.vaultPath,
        ...config
      });
    }
  }
  
  /**
   * Get file operations handler
   */
  getFileOperationsHandler(): FileOperationsHandlerImpl | undefined {
    return this.fileOperationsHandler;
  }
  
  /**
   * Start an agent process and establish connection
   */
  async startAgent(agentPath: string, args: string[]): Promise<void> {
    // Create agent config
    const agentId = `agent-${Date.now()}`;
    const config: AgentConfig = {
      id: agentId,
      name: `Agent ${agentId}`,
      command: agentPath,
      args,
      enabled: true
    };
    
    await this.startAgentWithConfig(config);
  }
  
  /**
   * Start an agent with full configuration
   */
  async startAgentWithConfig(config: AgentConfig): Promise<void> {
    if (this.connections.has(config.id)) {
      throw new Error(`Agent ${config.id} is already connected`);
    }
    
    try {
      // Start the process
      await this.processManager.startAgent(config);
      
      // Get the process from the manager
      const process = (this.processManager as any).processes.get(config.id);
      if (!process) {
        throw new Error(`Failed to get process for agent ${config.id}`);
      }
      
      // Create stdio transport
      const transport = new StdioTransport(process, config.id);
      
      // Create JSON-RPC client
      const jsonRpcClient = new JsonRpcClient({
        defaultTimeout: this.options.requestTimeout,
        maxPendingRequests: this.options.maxPendingRequests
      });
      
      // Set up transport
      jsonRpcClient.setTransport(transport);
      
      // Register method handlers
      this.registerMethodHandlers(jsonRpcClient);
      
      // Create connection record
      const connection: AgentConnection = {
        agentId: config.id,
        config,
        processHealth: this.processManager.getProcessHealth(config.id)!,
        connectionState: transport.getConnectionState(),
        jsonRpcClient,
        transport
      };
      
      this.connections.set(config.id, connection);
      
      // Set up transport event handlers
      this.setupTransportEvents(connection);
      
      // Initialize the connection with the agent
      try {
        await this.initializeConnection(config.id);
      } catch (error) {
        // Clean up on initialization failure
        this.connections.delete(config.id);
        await this.processManager.stopAgent(config.id).catch(() => {});
        throw new Error(`Failed to initialize agent connection: ${error.message}`);
      }
      
      this.emit('agent-connected', config.id, this.getConnectionStatus(config.id));
      
    } catch (error) {
      // Clean up on failure
      await this.processManager.stopAgent(config.id).catch(() => {});
      throw error;
    }
  }
  /**
   * Initialize the connection with the agent
   */
  async initializeConnection(agentId?: string): Promise<InitializeResult> {
    const connection = agentId ? this.connections.get(agentId) : this.getFirstAvailableConnection();

    if (!connection) {
      throw new Error('No agent connection available for initialization');
    }

    const params: InitializeParams = {
      protocolVersion: 1, // Current ACP protocol version
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true
        }
      },
      clientInfo: {
        name: 'obsidian-acp-chat',
        title: 'Obsidian ACP Chat Plugin',
        version: '1.0.0'
      }
    };

    try {
      const result = await connection.jsonRpcClient.sendRequest('initialize', params);

      // Store the negotiated capabilities
      if (result && result.agentCapabilities) {
        connection.agentCapabilities = result.agentCapabilities;
      }

      return result as InitializeResult;
    } catch (error) {
      throw new Error(`Failed to initialize connection: ${error.message}`);
    }
  }
  /**
   * Check if a connection is properly initialized
   */
  isConnectionInitialized(agentId?: string): boolean {
    const connection = agentId ? this.connections.get(agentId) : this.getFirstAvailableConnection();
    return connection ? !!connection.agentCapabilities : false;
  }
  /**
   * Test basic communication with the agent
   */
  async testAgentCommunication(agentId?: string): Promise<boolean> {
    const connection = agentId ? this.connections.get(agentId) : this.getFirstAvailableConnection();

    if (!connection) {
      console.log('No agent connection available for testing');
      return false;
    }

    console.log(`Testing communication with agent ${connection.agentId}...`);
    console.log(`Connection state:`, connection.connectionState);
    console.log(`Transport connected:`, connection.transport.isConnected());
    console.log(`Process PID:`, connection.processHealth.pid);
    console.log(`Process status:`, connection.processHealth.status);

    // Try a simple ping-like request first
    try {
      console.log('Sending test request...');
      const result = await connection.jsonRpcClient.sendRequest('test', {}, 5000);
      console.log('Test request succeeded:', result);
      return true;
    } catch (error) {
      console.log('Test request failed:', error.message);

      // Try initialize request
      try {
        console.log('Trying initialize request...');
        const initResult = await this.initializeConnection(connection.agentId);
        console.log('Initialize succeeded:', initResult);
        return true;
      } catch (initError) {
        console.log('Initialize failed:', initError.message);
        return false;
      }
    }
  }
  
  /**
   * Stop an agent process
   */
  async stopAgent(): Promise<void> {
    // Stop all agents
    const agentIds = Array.from(this.connections.keys());
    
    for (const agentId of agentIds) {
      await this.stopAgentById(agentId);
    }
  }
  
  /**
   * Stop a specific agent by ID
   */
  async stopAgentById(agentId: string): Promise<void> {
    const connection = this.connections.get(agentId);
    if (!connection) {
      return; // Already stopped
    }
    
    try {
      // Close JSON-RPC client
      connection.jsonRpcClient.close();
      
      // Close transport
      connection.transport.close();
      
      // Stop process
      await this.processManager.stopAgent(agentId);
      
      // Remove connection
      this.connections.delete(agentId);
      
      this.emit('agent-disconnected', agentId);
      
    } catch (error) {
      console.error(`Error stopping agent ${agentId}:`, error);
      
      // Force cleanup
      this.connections.delete(agentId);
      this.processManager.killAgent(agentId);
      
      throw error;
    }
  }
  
  /**
   * Send a JSON-RPC request to an agent
   */
  async sendRequest(method: string, params: any): Promise<any> {
    // Send to the first available agent (for now)
    const connection = this.getFirstAvailableConnection();
    if (!connection) {
      throw new Error('No agents connected');
    }
    
    return connection.jsonRpcClient.sendRequest(method, params);
  }
  
  /**
   * Send a JSON-RPC notification to an agent
   */
  sendNotification(method: string, params: any): void {
    // Send to the first available agent (for now)
    const connection = this.getFirstAvailableConnection();
    if (!connection) {
      throw new Error('No agents connected');
    }
    
    connection.jsonRpcClient.sendNotification(method, params);
  }
  
  /**
   * Send request to a specific agent
   */
  async sendRequestToAgent(agentId: string, method: string, params: any): Promise<any> {
    const connection = this.connections.get(agentId);
    if (!connection) {
      throw new Error(`Agent ${agentId} is not connected`);
    }
    
    return connection.jsonRpcClient.sendRequest(method, params);
  }
  
  /**
   * Send notification to a specific agent
   */
  sendNotificationToAgent(agentId: string, method: string, params: any): void {
    const connection = this.connections.get(agentId);
    if (!connection) {
      throw new Error(`Agent ${agentId} is not connected`);
    }
    
    connection.jsonRpcClient.sendNotification(method, params);
  }
  
  /**
   * Handle file read requests from agents
   */
  async handleFsReadTextFile(params: FsReadTextFileParams): Promise<FsReadTextFileResult> {
    if (this.fsReadTextFileHandler) {
      return this.fsReadTextFileHandler(params);
    }
    
    if (this.acpFileSystemHandlers) {
      return this.acpFileSystemHandlers.handleFsReadTextFile(params);
    }
    
    throw new JsonRpcError(-32601, 'File read handler not registered');
  }
  
  /**
   * Handle file write requests from agents
   */
  async handleFsWriteTextFile(params: FsWriteTextFileParams): Promise<void> {
    if (this.fsWriteTextFileHandler) {
      return this.fsWriteTextFileHandler(params);
    }
    
    if (this.acpFileSystemHandlers) {
      return this.acpFileSystemHandlers.handleFsWriteTextFile(params);
    }
    
    throw new JsonRpcError(-32601, 'File write handler not registered');
  }
  
  /**
   * Handle permission requests from agents
   */
  async handleSessionRequestPermission(params: SessionRequestPermissionParams): Promise<SessionRequestPermissionResult> {
    if (!this.sessionRequestPermissionHandler) {
      throw new Error('Permission handler not registered');
    }
    
    return this.sessionRequestPermissionHandler(params);
  }
  
  /**
   * Handle session updates from agents
   */
  handleSessionUpdate(params: SessionUpdateParams): void {
    // Forward to session manager if available
    if (this.sessionManager) {
      this.sessionManager.handleStreamingUpdate(params);
    }

    // Also call the custom handler if set
    if (this.sessionUpdateHandler) {
      this.sessionUpdateHandler(params);
    }
    
    this.emit('session-update', params);
  }
  
  /**
   * Register method handlers
   */
  setFsReadTextFileHandler(handler: (params: FsReadTextFileParams) => Promise<FsReadTextFileResult>): void {
    this.fsReadTextFileHandler = handler;
  }
  
  setFsWriteTextFileHandler(handler: (params: FsWriteTextFileParams) => Promise<void>): void {
    this.fsWriteTextFileHandler = handler;
  }
  
  setSessionRequestPermissionHandler(handler: (params: SessionRequestPermissionParams) => Promise<SessionRequestPermissionResult>): void {
    this.sessionRequestPermissionHandler = handler;
  }
  
  setSessionUpdateHandler(handler: (params: SessionUpdateParams) => void): void {
    this.sessionUpdateHandler = handler;
  }

  /**
   * Set session manager reference for streaming updates
   */
  setSessionManager(sessionManager: SessionManager): void {
    this.sessionManager = sessionManager;
  }

  /**
   * Get session manager reference
   */
  getSessionManager(): SessionManager | undefined {
    return this.sessionManager;
  }
  
  /**
   * Get connection status for an agent
   */
  getConnectionStatus(agentId: string): ConnectionStatus {
    const connection = this.connections.get(agentId);
    if (!connection) {
      return { connected: false };
    }
    
    const isConnected = connection.transport.isConnected() && 
                       connection.processHealth.status === 'running';
    
    // Get capabilities from the connection's negotiated capabilities
    const capabilities = this.getAgentCapabilities(connection);
    
    return {
      connected: isConnected,
      agentName: connection.config.name,
      capabilities,
      error: connection.processHealth.status === 'error' ? 'Process error' : undefined
    };
  }

  /**
   * Get agent capabilities from connection
   */
  private getAgentCapabilities(connection: AgentConnection): string[] {
    // Check if capabilities were negotiated during connection
    if ((connection as any).negotiatedCapabilities) {
      return (connection as any).negotiatedCapabilities;
    }

    // Default capabilities based on what the client supports
    const defaultCapabilities = [
      'fs/read_text_file',
      'fs/write_text_file', 
      'session/request_permission',
      'session/update'
    ];

    // If the connection has a session manager, add session capabilities
    if (connection.jsonRpcClient) {
      defaultCapabilities.push(
        'session/new',
        'session/prompt',
        'session/cancel'
      );
    }

    return defaultCapabilities;
  }
  
  /**
   * Get all connection statuses
   */
  getAllConnectionStatuses(): Map<string, ConnectionStatus> {
    const statuses = new Map<string, ConnectionStatus>();
    
    for (const [agentId] of this.connections) {
      statuses.set(agentId, this.getConnectionStatus(agentId));
    }
    
    return statuses;
  }
  
  /**
   * Get connected agent IDs
   */
  getConnectedAgents(): string[] {
    return Array.from(this.connections.keys()).filter(agentId => {
      const status = this.getConnectionStatus(agentId);
      return status.connected;
    });
  }
  
  /**
   * Restart an agent
   */
  async restartAgent(agentId: string): Promise<void> {
    const connection = this.connections.get(agentId);
    if (!connection) {
      throw new Error(`Agent ${agentId} is not connected`);
    }
    
    const config = connection.config;
    
    // Stop the current agent
    await this.stopAgentById(agentId);
    
    // Start it again
    await this.startAgentWithConfig(config);
  }
  
  /**
   * Shutdown all agents and cleanup
   */
  async shutdown(): Promise<void> {
    // Stop all agents
    await this.stopAgent();
    
    // Shutdown process manager
    await this.processManager.shutdown();
    
    // Clear connections
    this.connections.clear();
    
    this.emit('shutdown');
  }
  
  /**
   * Get client statistics
   */
  getStats(): {
    connectedAgents: number;
    totalConnections: number;
    processStats: Map<string, ProcessHealth>;
    transportStats: Map<string, any>;
  } {
    const transportStats = new Map();
    
    for (const [agentId, connection] of this.connections) {
      transportStats.set(agentId, {
        ...connection.transport.getStats(),
        jsonRpcStats: connection.jsonRpcClient.getStats()
      });
    }
    
    return {
      connectedAgents: this.getConnectedAgents().length,
      totalConnections: this.connections.size,
      processStats: this.processManager.getAllProcessHealth(),
      transportStats
    };
  }
  
  /**
   * Get the first available connection
   */
  private getFirstAvailableConnection(): AgentConnection | undefined {
    for (const connection of this.connections.values()) {
      if (connection.transport.isConnected() && 
          connection.processHealth.status === 'running') {
        return connection;
      }
    }
    return undefined;
  }
  
  /**
   * Set up process manager event handlers
   */
  private setupProcessManagerEvents(): void {
    this.processManager.on('process-started', (agentId, pid) => {
      this.emit('process-started', agentId, pid);
    });
    
    this.processManager.on('process-stopped', (agentId, code, signal) => {
      this.emit('process-stopped', agentId, code, signal);
      
      // Clean up connection
      const connection = this.connections.get(agentId);
      if (connection) {
        connection.jsonRpcClient.close();
        connection.transport.close();
        this.connections.delete(agentId);
        this.emit('agent-disconnected', agentId);
      }
    });
    
    this.processManager.on('process-error', (agentId, error) => {
      this.emit('process-error', agentId, error);
    });
    
    this.processManager.on('health-check', (agentId, health) => {
      // Update connection health
      const connection = this.connections.get(agentId);
      if (connection) {
        connection.processHealth = health;
      }
      
      this.emit('health-check', agentId, health);
    });
  }
  
  /**
   * Set up transport event handlers for a connection
   */
  private setupTransportEvents(connection: AgentConnection): void {
    const { transport, agentId } = connection;
    
    transport.on('transport-connected', () => {
      this.emit('transport-connected', agentId);
    });
    
    transport.on('transport-closed', () => {
      this.emit('transport-closed', agentId);
    });
    
    transport.on('transport-error', (_, error) => {
      this.emit('transport-error', agentId, error);
    });
    
    transport.on('message-sent', (_, message) => {
      this.emit('message-sent', agentId, message);
    });
    
    transport.on('message-received', (_, message) => {
      this.emit('message-received', agentId, message);
    });
  }
  
  /**
   * Register JSON-RPC method handlers for a client
   */
  private registerMethodHandlers(jsonRpcClient: JsonRpcClient): void {
    // Register ACP method handlers
    jsonRpcClient.registerMethod('fs/read_text_file', async (params) => {
      try {
        return await this.handleFsReadTextFile(params);
      } catch (error) {
        if (error instanceof JsonRpcError) {
          throw error;
        }
        throw new JsonRpcError(-32603, `Internal error: ${error.message}`);
      }
    });
    
    jsonRpcClient.registerMethod('fs/write_text_file', async (params) => {
      try {
        await this.handleFsWriteTextFile(params);
        return {}; // ACP expects empty result for write operations
      } catch (error) {
        if (error instanceof JsonRpcError) {
          throw error;
        }
        throw new JsonRpcError(-32603, `Internal error: ${error.message}`);
      }
    });
    
    jsonRpcClient.registerMethod('session/request_permission', async (params) => {
      try {
        return await this.handleSessionRequestPermission(params);
      } catch (error) {
        throw new JsonRpcError(-32603, `Permission request failed: ${error.message}`);
      }
    });
    
    // Register notification handlers
    jsonRpcClient.registerNotification('session/update', (params) => {
      this.handleSessionUpdate(params);
    });
  }
}