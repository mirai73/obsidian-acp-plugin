/**
 * Agent Process Manager
 * Manages the lifecycle of ACP agent child processes
 */

import { ChildProcess, spawn, SpawnOptions, exec } from 'child_process';
import { EventEmitter } from 'events';
import * as os from 'os';

export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  enabled: boolean;
}

export interface ProcessHealth {
  pid?: number;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  startTime?: Date;
  lastHealthCheck?: Date;
  errorCount: number;
  restartCount: number;
}

export interface ProcessEvents {
  'process-started': (agentId: string, pid: number) => void;
  'process-stopped': (agentId: string, code: number | null, signal: string | null) => void;
  'process-error': (agentId: string, error: Error) => void;
  'health-check': (agentId: string, health: ProcessHealth) => void;
  'stdout-data': (agentId: string, data: Buffer) => void;
  'stderr-data': (agentId: string, data: Buffer) => void;
}

/**
 * Manages ACP agent child processes with lifecycle management and health monitoring
 */
export class AgentProcessManager extends EventEmitter {
  private processes = new Map<string, ChildProcess>();
  private processHealth = new Map<string, ProcessHealth>();
  private healthCheckInterval?: NodeJS.Timeout;
  private readonly healthCheckIntervalMs = 30000; // 30 seconds
  private readonly maxRestartAttempts = 3;
  private readonly restartDelayMs = 5000; // 5 seconds
  
  constructor() {
    super();
    this.startHealthMonitoring();
  }
  
  /**
   * Start an agent process
   */
  async startAgent(config: AgentConfig): Promise<void> {
    if (this.processes.has(config.id)) {
      throw new Error(`Agent ${config.id} is already running`);
    }
    
    if (!config.enabled) {
      throw new Error(`Agent ${config.id} is disabled`);
    }
    
    // Initialize health tracking
    const existingHealth = this.processHealth.get(config.id);
    const health: ProcessHealth = {
      status: 'starting',
      startTime: new Date(),
      errorCount: existingHealth ? existingHealth.errorCount : 0,
      restartCount: existingHealth ? existingHealth.restartCount : 0
    };
    this.processHealth.set(config.id, health);
    
    try {
      const process = await this.spawnProcess(config);
      this.processes.set(config.id, process);
      
      // Update health status
      health.status = 'running';
      health.pid = process.pid;
      health.lastHealthCheck = new Date();
      
      this.emit('process-started', config.id, process.pid!);
      this.emit('health-check', config.id, health);
      
    } catch (error) {
      health.status = 'error';
      health.errorCount++;
      this.processHealth.set(config.id, health);
      
      this.emit('process-error', config.id, error as Error);
      throw error;
    }
  }
  
  /**
   * Stop an agent process gracefully
   */
  async stopAgent(agentId: string, timeout: number = 10000): Promise<void> {
    const process = this.processes.get(agentId);
    const health = this.processHealth.get(agentId);
    
    if (!process || !health) {
      return; // Already stopped
    }
    console.log(`Killing ${process.pid} `)
    health.status = 'stopping';
    this.emit('health-check', agentId, health);
    
    return new Promise<void>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        // Force kill if graceful shutdown fails
        if (process.pid && !process.killed) {
          process.kill('SIGKILL');
        }
        reject(new Error(`Agent ${agentId} failed to stop gracefully within ${timeout}ms`));
      }, timeout);
      
      process.once('exit', (code, signal) => {
        clearTimeout(timeoutHandle);
        this.handleProcessExit(agentId, code, signal);
        resolve();
      });
      
      // Send SIGTERM for graceful shutdown
      if (process.pid && !process.killed) {
        process.kill('SIGTERM');
      }
    });
  }
  
  /**
   * Force kill an agent process
   */
  killAgent(agentId: string): void {
    const process = this.processes.get(agentId);
    if (process && process.pid && !process.killed) {
      process.kill('SIGKILL');
    }
  }
  
  /**
   * Get process health information
   */
  getProcessHealth(agentId: string): ProcessHealth | undefined {
    return this.processHealth.get(agentId);
  }
  
  /**
   * Get all process health information
   */
  getAllProcessHealth(): Map<string, ProcessHealth> {
    return new Map(this.processHealth);
  }
  
  /**
   * Check if an agent is running
   */
  isAgentRunning(agentId: string): boolean {
    const health = this.processHealth.get(agentId);
    return health?.status === 'running';
  }
  
  /**
   * Get running agent IDs
   */
  getRunningAgents(): string[] {
    return Array.from(this.processHealth.entries())
      .filter(([_, health]) => health.status === 'running')
      .map(([agentId]) => agentId);
  }
  
  /**
   * Restart an agent process
   */
  async restartAgent(agentId: string, config: AgentConfig): Promise<void> {
    const health = this.processHealth.get(agentId);
    
    if (health && health.restartCount >= this.maxRestartAttempts) {
      throw new Error(`Agent ${agentId} has exceeded maximum restart attempts (${this.maxRestartAttempts})`);
    }
    
    // Stop the current process if running
    if (this.isAgentRunning(agentId)) {
      await this.stopAgent(agentId);
    }
    
    // Wait before restarting
    await new Promise(resolve => setTimeout(resolve, this.restartDelayMs));
    
    // Increment restart count
    if (health) {
      health.restartCount++;
    }
    
    // Start the agent again
    await this.startAgent(config);
  }
  
  /**
   * Shutdown all agents gracefully
   */
  async shutdown(timeout: number = 30000): Promise<void> {
    const runningAgents = this.getRunningAgents();
    
    if (runningAgents.length === 0) {
      this.stopHealthMonitoring();
      return;
    }
    
    // Stop all agents in parallel
    const stopPromises = runningAgents.map(agentId => 
      this.stopAgent(agentId, timeout).catch(error => {
        console.error(`Failed to stop agent ${agentId}:`, error);
        this.killAgent(agentId);
      })
    );
    
    await Promise.allSettled(stopPromises);
    this.stopHealthMonitoring();
  }
  
  /**
   * Spawn a child process for an agent
   */
  private async spawnProcess(config: AgentConfig): Promise<ChildProcess> {
    return new Promise<ChildProcess>(async (resolve, reject) => {
      // Fetch full interactive path so GUI apps like Obsidian get the real PATH
      const fullPath = await this.getUserPath();

      const options: SpawnOptions = {
        cwd: config.workingDirectory,
        env: {
          ...process.env,
          PATH: fullPath,
          ...config.environment
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32' || process.env.SHELL || true
      };
      
      const childProcess = spawn(config.command, config.args, options);
      
      // Handle process events
      childProcess.on('error', (error: Error) => {
        reject(new Error(`Failed to spawn agent ${config.id}: ${error.message}`));
      });
      
      childProcess.on('exit', (code: number | null, signal: string | null) => {
        this.handleProcessExit(config.id, code, signal);
      });
      
      // Set up stdio event handlers
      if (childProcess.stdout) {
        childProcess.stdout.on('data', (data: Buffer) => {
          this.emit('stdout-data', config.id, data);
        });
      }
      
      if (childProcess.stderr) {
        childProcess.stderr.on('data', (data: Buffer) => {
          this.emit('stderr-data', config.id, data);
        });
      }
      
      // Wait a moment to ensure the process started successfully
      setTimeout(() => {
        if (childProcess.pid && !childProcess.killed) {
          resolve(childProcess);
        } else {
          reject(new Error(`Agent ${config.id} failed to start`));
        }
      }, 1000);
    });
  }
  
  /**
   * Handle process exit
   */
  private handleProcessExit(agentId: string, code: number | null, signal: string | null): void {
    const health = this.processHealth.get(agentId);
    
    if (health) {
      health.status = 'stopped';
      health.pid = undefined;
      
      if (code !== 0 && code !== null) {
        health.errorCount++;
        health.status = 'error';
      }
    }
    
    this.processes.delete(agentId);
    this.emit('process-stopped', agentId, code, signal);
    
    if (health) {
      this.emit('health-check', agentId, health);
    }
  }
  
  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.healthCheckIntervalMs);
  }
  
  /**
   * Stop health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }
  
  /**
   * Perform health checks on all running processes
   */
  private performHealthChecks(): void {
    for (const [agentId, health] of this.processHealth.entries()) {
      if (health.status === 'running') {
        const process = this.processes.get(agentId);
        
        if (!process || process.killed || !process.pid) {
          // Process is no longer running
          health.status = 'error';
          health.errorCount++;
          this.processes.delete(agentId);
        } else {
          // Update last health check time
          health.lastHealthCheck = new Date();
        }
        
        this.emit('health-check', agentId, health);
      }
    }
  }
  
  /**
   * Helper to fetch the actual user PATH by invoking the shell
   */
  private async getUserPath(): Promise<string> {
    if (process.platform === 'win32') {
      return process.env.PATH || '';
    }

    return new Promise<string>((resolve) => {
      const shell = process.env.SHELL || '/bin/zsh';
      // Run an interactive login shell to execute `echo $PATH`
      exec(`${shell} -ilc 'echo $PATH'`, { timeout: 2000 }, (error, stdout) => {
        if (error || !stdout) {
          // If execution fails, default to process.env.PATH plus standard homebrew/local paths
          const homeDir = os.homedir();
          resolve([
            process.env.PATH,
            '/usr/local/bin',
            '/opt/homebrew/bin',
            '/opt/homebrew/sbin',
            `${homeDir}/.local/bin`,
            `${homeDir}/.cargo/bin`
          ].filter(Boolean).join(':'));
          return;
        }

        // Split by newlines, grab the last one in case there are other shell initialization outputs
        const lines = stdout.trim().split('\n');
        resolve(lines[lines.length - 1].trim());
      });
    });
  }
}