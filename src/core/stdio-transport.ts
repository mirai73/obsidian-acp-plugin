/**
 * Stdio Transport
 * Implements JSON-RPC 2.0 communication over stdin/stdout for ACP agents
 */

import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { MessageTransport } from './json-rpc-client';

export interface StdioTransportOptions {
	messageDelimiter?: string;
	encoding?: BufferEncoding;
	maxMessageSize?: number;
	connectionTimeout?: number;
}

export interface ConnectionState {
	connected: boolean;
	agentId: string;
	pid?: number;
	startTime?: Date;
	lastMessageTime?: Date;
	messagesSent: number;
	messagesReceived: number;
	bytesReceived: number;
	bytesSent: number;
}

/**
 * Transport implementation for JSON-RPC communication over stdio
 */
export class StdioTransport extends EventEmitter implements MessageTransport {
	private process: ChildProcess;
	private agentId: string;
	private options: Required<StdioTransportOptions>;
	private connectionState: ConnectionState;
	private messageBuffer: string = '';
	private messageHandler?: (message: string) => void;
	private errorHandler?: (error: Error) => void;
	private closeHandler?: () => void;
	private isClosing = false;

	constructor(
		process: ChildProcess,
		agentId: string,
		options: StdioTransportOptions = {}
	) {
		super();

		this.process = process;
		this.agentId = agentId;
		this.options = {
			messageDelimiter: '\n',
			encoding: 'utf8',
			maxMessageSize: 1024 * 1024, // 1MB
			connectionTimeout: 30000, // 30 seconds
			...options,
		};

		this.connectionState = {
			connected: false,
			agentId,
			pid: process.pid,
			messagesSent: 0,
			messagesReceived: 0,
			bytesReceived: 0,
			bytesSent: 0,
		};

		this.setupProcessHandlers();
		this.initializeConnection();
	}

	/**
	 * Send a message to the agent process
	 */
	send(message: string): void {
		if (!this.connectionState.connected || this.isClosing) {
			throw new Error(
				`Cannot send message: transport is not connected (agent: ${this.agentId})`
			);
		}

		if (!this.process.stdin || this.process.stdin.destroyed) {
			throw new Error(
				`Cannot send message: stdin is not available (agent: ${this.agentId})`
			);
		}

		try {
			// Add delimiter and encode message
			const messageWithDelimiter = message + this.options.messageDelimiter;
			const messageBuffer = Buffer.from(
				messageWithDelimiter,
				this.options.encoding
			);

			// Check message size
			if (messageBuffer.length > this.options.maxMessageSize) {
				throw new Error(
					`Message too large: ${messageBuffer.length} bytes exceeds limit of ${this.options.maxMessageSize} bytes`
				);
			}

			// Write to stdin
			const success = this.process.stdin.write(messageBuffer);

			if (success) {
				// Update statistics
				this.connectionState.messagesSent++;
				this.connectionState.bytesSent += messageBuffer.length;
				this.connectionState.lastMessageTime = new Date();

				this.emit('message-sent', this.agentId, message);
			} else {
				// Handle backpressure
				this.process.stdin.once('drain', () => {
					this.connectionState.messagesSent++;
					this.connectionState.bytesSent += messageBuffer.length;
					this.connectionState.lastMessageTime = new Date();
					this.emit('message-sent', this.agentId, message);
				});
			}
		} catch (error) {
			this.handleError(
				new Error(`Failed to send message to agent ${this.agentId}: ${error}`)
			);
			throw error;
		}
	}

	/**
	 * Set message handler for incoming messages
	 */
	onMessage(handler: (message: string) => void): void {
		this.messageHandler = handler;
	}

	/**
	 * Set error handler
	 */
	onError(handler: (error: Error) => void): void {
		this.errorHandler = handler;
	}

	/**
	 * Set close handler
	 */
	onClose(handler: () => void): void {
		this.closeHandler = handler;
	}

	/**
	 * Close the transport connection
	 */
	close(): void {
		if (this.isClosing) {
			return;
		}

		this.isClosing = true;
		this.connectionState.connected = false;

		try {
			// Close stdin to signal the process to shut down
			if (this.process.stdin && !this.process.stdin.destroyed) {
				this.process.stdin.end();
			}

			// Remove all listeners to prevent memory leaks
			this.removeAllListeners();

			// Clear message buffer
			this.messageBuffer = '';

			this.emit('transport-closed', this.agentId);

			if (this.closeHandler) {
				this.closeHandler();
			}
		} catch (error) {
			console.error(
				`Error closing transport for agent ${this.agentId}:`,
				error
			);
		}
	}

	/**
	 * Get connection state information
	 */
	getConnectionState(): ConnectionState {
		return { ...this.connectionState };
	}

	/**
	 * Check if transport is connected
	 */
	isConnected(): boolean {
		return this.connectionState.connected && !this.isClosing;
	}

	/**
	 * Get agent ID
	 */
	getAgentId(): string {
		return this.agentId;
	}

	/**
	 * Initialize the connection
	 */
	private initializeConnection(): void {
		// Set connection timeout
		const timeout = setTimeout(() => {
			if (!this.connectionState.connected) {
				this.handleError(
					new Error(`Connection timeout for agent ${this.agentId}`)
				);
			}
		}, this.options.connectionTimeout);

		// Mark as connected once we have stdio streams
		if (this.process.stdout && this.process.stdin) {
			this.connectionState.connected = true;
			this.connectionState.startTime = new Date();
			clearTimeout(timeout);
			this.emit('transport-connected', this.agentId);
		} else {
			clearTimeout(timeout);
			this.handleError(
				new Error(
					`Failed to initialize stdio streams for agent ${this.agentId}`
				)
			);
		}
	}

	/**
	 * Set up process event handlers
	 */
	private setupProcessHandlers(): void {
		// Handle stdout data (incoming messages)
		if (this.process.stdout) {
			this.process.stdout.setEncoding(this.options.encoding);
			this.process.stdout.on('data', (data: string) => {
				this.handleIncomingData(data);
			});

			this.process.stdout.on('error', (error) => {
				this.handleError(
					new Error(`Stdout error for agent ${this.agentId}: ${error.message}`)
				);
			});
		}

		// Handle stdin errors
		if (this.process.stdin) {
			this.process.stdin.on('error', (error) => {
				this.handleError(
					new Error(`Stdin error for agent ${this.agentId}: ${error.message}`)
				);
			});
		}

		// Handle process exit
		this.process.on('exit', (code, signal) => {
			this.connectionState.connected = false;
			this.emit('process-exit', this.agentId, code, signal);
			this.close();
		});

		// Handle process errors
		this.process.on('error', (error) => {
			this.handleError(
				new Error(`Process error for agent ${this.agentId}: ${error.message}`)
			);
		});
	}

	/**
	 * Handle incoming data from stdout
	 */
	private handleIncomingData(data: string): void {
		try {
			// Add data to buffer
			this.messageBuffer += data;

			// Check buffer size limit
			if (this.messageBuffer.length > this.options.maxMessageSize) {
				throw new Error(
					`Message buffer too large: ${this.messageBuffer.length} bytes exceeds limit`
				);
			}

			// Process complete messages
			this.processBufferedMessages();
		} catch (error) {
			this.handleError(
				new Error(
					`Error processing incoming data for agent ${this.agentId}: ${error}`
				)
			);
		}
	}

	/**
	 * Process complete messages from the buffer
	 */
	private processBufferedMessages(): void {
		const delimiter = this.options.messageDelimiter;
		let delimiterIndex: number;

		while ((delimiterIndex = this.messageBuffer.indexOf(delimiter)) !== -1) {
			// Extract complete message
			const message = this.messageBuffer.substring(0, delimiterIndex);

			// Remove processed message from buffer
			this.messageBuffer = this.messageBuffer.substring(
				delimiterIndex + delimiter.length
			);

			// Skip empty messages
			if (message.trim().length === 0) {
				continue;
			}

			try {
				// Update statistics
				this.connectionState.messagesReceived++;
				this.connectionState.bytesReceived += Buffer.byteLength(
					message,
					this.options.encoding
				);
				this.connectionState.lastMessageTime = new Date();

				// Emit message received event
				this.emit('message-received', this.agentId, message);

				// Call message handler
				if (this.messageHandler) {
					this.messageHandler(message);
				}
			} catch (error) {
				this.handleError(
					new Error(
						`Error handling message for agent ${this.agentId}: ${error}`
					)
				);
			}
		}
	}

	/**
	 * Handle transport errors
	 */
	private handleError(error: Error): void {
		this.emit('transport-error', this.agentId, error);

		if (this.errorHandler) {
			this.errorHandler(error);
		} else {
			console.error(`Stdio transport error for agent ${this.agentId}:`, error);
		}
	}

	/**
	 * Get transport statistics
	 */
	getStats(): {
		messagesSent: number;
		messagesReceived: number;
		bytesSent: number;
		bytesReceived: number;
		bufferSize: number;
		uptime: number;
	} {
		const uptime = this.connectionState.startTime
			? Date.now() - this.connectionState.startTime.getTime()
			: 0;

		return {
			messagesSent: this.connectionState.messagesSent,
			messagesReceived: this.connectionState.messagesReceived,
			bytesSent: this.connectionState.bytesSent,
			bytesReceived: this.connectionState.bytesReceived,
			bufferSize: Buffer.byteLength(this.messageBuffer, this.options.encoding),
			uptime,
		};
	}
}
