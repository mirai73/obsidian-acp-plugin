/**
 * Chat View Component
 * Implements the dockable chat panel for Obsidian using ItemView
 */

import {
	ItemView,
	WorkspaceLeaf,
	MarkdownRenderer,
	Component,
	setIcon,
	SuggestModal,
	App,
	Notice,
	TFile,
} from 'obsidian';
import {
	Message,
	ConnectionStatus,
	SessionRequestPermissionParams,
	AcpCommand,
} from '../types/acp';
import { ChatInterface } from '../interfaces/chat-interface';
import { ACPClientImpl } from '../core/acp-client-impl';
import { SessionManagerImpl, SessionContext } from '../core/session-manager';
import { ACPClient } from 'src/interfaces/acp-client';
import { ExtensionToMime } from 'src/types/plugin';

export const CHAT_VIEW_TYPE = 'acp-chat-view';

interface QueuedMessage {
	text: string;
	agentMessage: Message;
}

export class ChatView extends ItemView implements ChatInterface {
	private messagesContainer: HTMLElement;
	private inputContainer: HTMLElement;
	private inputField: HTMLTextAreaElement;
	private sendButton: HTMLButtonElement;
	private statusIndicator: HTMLElement;
	private connectionStatus: ConnectionStatus = { connected: false };
	private isProcessing = false;
	private pendingPermissionResolvers = new Map<
		string,
		(id: string | null) => void
	>();
	private acpClient: ACPClientImpl | null = null;
	private sessionManager: SessionManagerImpl | null = null;
	private currentSessionId: string | null = null;
	private availableModes: any[] = [];
	private currentModeId: string | null = null;
	private modeSelector: HTMLSelectElement | null = null;
	private availableModels: any[] = [];
	private currentModelId: string | null = null;
	private modelSelector: HTMLSelectElement | null = null;
	private agentSelector: HTMLSelectElement | null = null;
	private agentNameEl: HTMLElement | null = null;
	private currentAgentId: string | null = null;
	private documentContextBox: HTMLElement | null = null;
	private activeFile: TFile | null = null;
	private isDocumentAddedToContext: boolean = false;
	private commandDropdown: HTMLElement | null = null;
	private selectedCommandIndex: number = -1;
	private filteredCommands: any[] = [];
	private readonly defaultCommands = [];
	private agentCommands: AcpCommand[] = [];
	private ensureSessionPromise: Promise<string> | null = null;
	private messageQueue: QueuedMessage[] = [];
	private queueIndicator: HTMLElement | null = null;

	private get commands() {
		return [...this.defaultCommands, ...this.agentCommands];
	}

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'ACP Chat';
	}

	getIcon(): string {
		return 'message-circle';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('acp-chat-container');

		this.createChatInterface(container);
		this.setupEventListeners();

		// Track active file from Obsidian
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				this.activeFile = file;
				this.updateDocumentContextBox();
			})
		);
		this.activeFile = this.app.workspace.getActiveFile();
		this.updateDocumentContextBox();

		// Proactively try to ensure session if already connected
		if (this.connectionStatus.connected) {
			console.log('OnOpen');
			this.ensureSession().catch((err) =>
				console.error('Failed to ensure session on open:', err)
			);
		}

		this.updateAgentNameDisplay();
	}

	async onClose(): Promise<void> {
		// Cleanup if needed
	}
	/**
	 * Set the ACP client for message sending
	 */
	setACPClient(client: ACPClientImpl): void {
		this.acpClient = client;

		// Initialize session manager with streaming callback
		this.sessionManager = new SessionManagerImpl({
			onStreamingChunk: (sessionId: string, chunk: any) => {
				this.handleStreamingChunk(sessionId, chunk);
			},
		});

		// Connect session manager to ACP client for streaming updates
		client.setSessionManager(this.sessionManager);

		// Don't set JSON-RPC client here - we'll set it when needed
	}

	private async ensureSession(): Promise<string> {
		if (this.ensureSessionPromise) {
			return this.ensureSessionPromise;
		}

		this.ensureSessionPromise = (async () => {
			try {
				console.log('Ensure session');
				if (!this.sessionManager || !this.acpClient) {
					throw new Error('Session manager or ACP client not initialized');
				}

				// Ensure we have a JSON-RPC client from a connected agent

				if (!this.currentSessionId) {
					// Use the vault path as the working directory
					// @ts-ignore
					const vaultPath = this.app.vault.adapter.basePath || process.cwd();

					const connectedAgentIds = this.acpClient.getConnectedAgents();
					const defaultAgentId = (this.app as any).plugins?.plugins?.[
						'acp-chat-assistant'
					]?.settings?.defaultAgentId;
					const agentId =
						this.currentAgentId ||
						(defaultAgentId && connectedAgentIds.includes(defaultAgentId)
							? defaultAgentId
							: connectedAgentIds[0]);

					const jsonRpcClient = this.getConnectedJsonRpcClient(agentId);
					if (!jsonRpcClient) {
						throw new Error(`No connected agents available for ${agentId}`);
					}

					const session = await this.sessionManager.createSession(
						agentId,
						jsonRpcClient,
						vaultPath
					);
					this.currentAgentId = agentId;
					this.currentSessionId = session.sessionId;

					// Update agent name in UI
					this.updateAgentNameDisplay();

					// Store modes from session result
					const sessionInfo = this.sessionManager.getSessionInfo(
						this.currentSessionId
					);
					if (sessionInfo && sessionInfo.modes) {
						this.availableModes = sessionInfo.modes.availableModes;
						this.currentModeId = sessionInfo.modes.currentModeId;
						this.updateModeSelector();
					}

					if (sessionInfo && sessionInfo.models) {
						this.availableModels = sessionInfo.models.availableModels || [];
						this.currentModelId = sessionInfo.models.currentModelId;
						this.updateModelSelector();
					}

					if (sessionInfo && sessionInfo.availableCommands) {
						this.agentCommands = sessionInfo.availableCommands.map((c) => ({
							description: c.description,
							name: `/${c.name}`,
						}));
					} else {
						this.agentCommands = [];
					}
				}
				return this.currentSessionId!;
			} finally {
				this.ensureSessionPromise = null;
			}
		})();

		return this.ensureSessionPromise;
	}

	private getConnectedJsonRpcClient(agentId?: string): any {
		if (!this.acpClient) {
			return null;
		}

		// Use the selected agent or the first available one
		const connections = this.acpClient.getConnections();
		if (!connections.has(agentId ?? this.currentAgentId ?? 'none')) return null;

		const connection = connections.get(
			agentId ?? this.currentAgentId ?? 'none'
		);

		return connection?.jsonRpcClient || null;
	}
	/**
	 * Refresh connection status and update JSON-RPC client if needed
	 */
	refreshConnection(): void {
		if (!this.acpClient || !this.sessionManager) {
			return;
		}

		// Check if we have any connected agents
		const connections = this.acpClient.getAllConnectionStatuses();
		let hasConnectedAgent = false;

		for (const [agentId, status] of connections) {
			if (status.connected) {
				hasConnectedAgent = true;
				break;
			}
		}

		// Update connection status
		if (hasConnectedAgent) {
			const firstConnection = connections.values().next().value;
			this.showConnectionStatus(firstConnection || { connected: false });
		} else {
			this.showConnectionStatus({ connected: false });
		}

		this.updateAgentNameDisplay();
	}

	private createChatInterface(container: Element): void {
		// Create main chat layout
		const chatWrapper = container.createDiv('acp-chat-wrapper');

		// Header section for session management
		const header = chatWrapper.createDiv('acp-chat-header');

		// New Session button
		const newSessionBtn = header.createEl('button', {
			cls: 'acp-header-btn',
			title: 'New Conversation',
		});
		setIcon(newSessionBtn, 'plus-circle');
		newSessionBtn.addEventListener('click', () => this.startNewConversation());

		// Session History button
		const historyBtn = header.createEl('button', {
			cls: 'acp-header-btn',
			title: 'Session History',
		});
		setIcon(historyBtn, 'history');
		historyBtn.addEventListener('click', () => this.showSessionHistory());

		// Messages container with scrolling
		this.messagesContainer = chatWrapper.createDiv('acp-messages-container');
		this.messagesContainer.addClass('acp-scrollable');

		// Clean input container
		this.inputContainer = chatWrapper.createDiv('acp-input-container');

		// Document Context Box above chat input
		this.documentContextBox = this.inputContainer.createDiv('acp-document-box');
		this.updateDocumentContextBox();

		// Input row with text area and enhanced send button
		const inputRow = this.inputContainer.createDiv('acp-input-row');

		// Text input area
		this.inputField = inputRow.createEl('textarea', {
			cls: 'acp-input-field',
			attr: {
				placeholder:
					'Ask me anything about your code, files, or development tasks...',
				rows: '1',
			},
		});

		// Selection row (Agent and Auto/Modality)
		const selectorsRow = this.inputContainer.createDiv('acp-selectors-row');

		// Agent dropdown
		const agentContainer = selectorsRow.createDiv('acp-selector-wrapper');
		this.agentNameEl = agentContainer.createSpan({
			text: this.getAgentName(this.currentAgentId) ?? 'None',
			cls: 'acp-selector-label',
		});
		// this.agentSelector = agentContainer.createEl('select', {
		// 	cls: 'acp-agent-selector is-readonly',
		// });
		// Interaction is now handled via the "New Conversation" button

		// Auto/Mode selector
		const modalityContainer = selectorsRow.createDiv('acp-selector-wrapper');
		// modalityContainer.createSpan({ text: 'Mode:', cls: 'acp-selector-label' });
		this.modeSelector = modalityContainer.createEl('select', {
			cls: 'acp-mode-selector',
		});
		this.modeSelector.addEventListener('change', () => {
			this.handleModeChange();
		});

		// Model selector
		const modelContainer = selectorsRow.createDiv('acp-selector-wrapper');
		// modelContainer.createSpan({ text: 'Model:', cls: 'acp-selector-label' });
		this.modelSelector = modelContainer.createEl('select', {
			cls: 'acp-model-selector',
		});
		this.modelSelector.addEventListener('change', () => {
			this.handleModelChange();
		});

		// Enhanced send button with dropdown
		const sendButtonContainer = inputRow.createDiv('acp-send-container');

		this.sendButton = selectorsRow.createEl('button', {
			cls: 'acp-send-button',
		});
		setIcon(this.sendButton, 'arrow-right');
		this.createCommandDropdown(inputRow);

		this.updateModeSelector();
		this.updateModelSelector();

		this.updateInputState();
	}

	private setupEventListeners(): void {
		// Send button click
		this.sendButton.addEventListener('click', () => {
			if (this.isProcessing && this.messageQueue.length === 0) {
				// Cancel mode: only cancel when processing with empty queue (Req 2.1)
				if (this.currentSessionId && this.sessionManager) {
					this.cancelPendingPermissions();
					this.sessionManager.cancelSession(this.currentSessionId);
					this.isProcessing = false;
				}
			} else {
				this.handleSendMessage();
			}
		});

		// Enter key to send (Shift+Enter for new line)
		this.inputField.addEventListener('keydown', (event) => {
			// Handle command dropdown navigation
			if (
				this.commandDropdown &&
				this.commandDropdown.style.display !== 'none'
			) {
				if (event.key === 'ArrowDown') {
					event.preventDefault();
					this.navigateCommandDropdown(1);
					return;
				} else if (event.key === 'ArrowUp') {
					event.preventDefault();
					this.navigateCommandDropdown(-1);
					return;
				} else if (event.key === 'Enter' || event.key === 'Tab') {
					if (this.selectedCommandIndex >= 0) {
						event.preventDefault();
						this.selectCommand(
							this.filteredCommands[this.selectedCommandIndex]
						);
						return;
					}
				} else if (event.key === 'Escape') {
					this.hideCommandDropdown();
					return;
				}
			}

			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				this.handleSendMessage();
			}
		});

		// Handle slash command trigger and filtering
		this.inputField.addEventListener('input', () => {
			this.autoResizeTextarea();
			this.updateInputState();

			const value = this.inputField.value;
			const cursorPosition = this.inputField.selectionStart;

			// Check if we just typed a slash at the beginning or after a space
			if (
				value.startsWith('/') &&
				cursorPosition <= value.split('\n')[0].length
			) {
				const query = value.substring(1).toLowerCase();
				this.showCommandDropdown(query);
				console.log('commands');
			} else {
				this.hideCommandDropdown();
			}
		});
	}

	private autoResizeTextarea(): void {
		this.inputField.style.height = 'auto';
		this.inputField.style.height =
			Math.min(this.inputField.scrollHeight, 120) + 'px';
	}

	private async handleSendMessage(): Promise<void> {
		const text = this.inputField.value.trim();
		if (!text || !this.connectionStatus.connected) {
			return;
		}

		// Clear input
		this.inputField.value = '';
		this.autoResizeTextarea();

		const userMessageForUI: Message = {
			role: 'user',
			content: [{ type: 'text', text: text }],
		};

		const userMessageForAgent: Message = {
			...userMessageForUI,
			content: [...userMessageForUI.content],
		};

		if (
			this.isDocumentAddedToContext &&
			this.activeFile &&
			this.getSessionMessages().length === 0
		) {
			userMessageForAgent.content.unshift({
				type: 'resource_link',
				uri: `file//${this.activeFile.path}`,
				name: this.activeFile.name,
				mimeType: ExtensionToMime[this.activeFile.extension] ?? 'text/plain',
				size: this.activeFile.stat.size,
				text: `Current document: ${this.activeFile.path}\n\n${text}`,
			});
		}

		if (this.isProcessing || this.messageQueue.length > 0) {
			// Enqueue the message for later dispatch
			this.messageQueue.push({ text, agentMessage: userMessageForAgent });
			this.displayMessage(userMessageForUI);
			this.updateQueueIndicator();
			return;
		}

		// Idle path: display and dispatch immediately
		this.displayMessage(userMessageForUI);
		await this.ensureSession();
		this.dispatchTurn(text, userMessageForAgent);
	}

	private async dispatchTurn(text: string, agentMessage: Message): Promise<void> {
		const turnSessionId = this.currentSessionId!;
		this.isProcessing = true;
		this.updateInputState();
		try {
			await this.sessionManager!.sendPrompt(turnSessionId, [agentMessage]);
			if (turnSessionId === this.currentSessionId) {
				this.finalizeStreamingMessage();
			}
		} catch (error) {
			if (turnSessionId === this.currentSessionId) {
				// Suppress error display if the turn was cancelled by the user
				if (
					!this.pendingPermissionResolvers.size &&
					error?.stopReason === 'cancelled'
				) {
					return;
				}
				const errorMessage: Message = {
					role: 'assistant',
					content: [
						{
							type: 'text',
							text: `Error: Failed to send message. ${error.message || 'Unknown error'}`,
						},
					],
				};
				this.displayMessage(errorMessage);
			}
		} finally {
			this.isProcessing = false;
			this.updateInputState();
			this.dequeueAndDispatch();
		}
	}

	private dequeueAndDispatch(): void {
		if (this.messageQueue.length > 0 && this.currentSessionId) {
			const next = this.messageQueue.shift()!;
			this.updateQueueIndicator();
			this.dispatchTurn(next.text, next.agentMessage);
		}
	}

	private updateQueueIndicator(): void {
		if (!this.queueIndicator) {
			this.queueIndicator = this.inputContainer.createDiv('acp-queue-indicator');
		}

		if (this.messageQueue.length > 0) {
			this.queueIndicator.textContent = `${this.messageQueue.length} pending`;
			this.queueIndicator.style.display = 'block';
		} else {
			this.queueIndicator.style.display = 'none';
		}
	}

	private handleSlashCommand(command: string): void {
		const cmd = command.toLowerCase();
		const activeFile = this.app.workspace.getActiveFile();

		let prompt = '';

		switch (true) {
			case cmd.startsWith('/explain'):
				prompt = activeFile
					? `Explain the code in ${activeFile.path}`
					: 'Please open a file to explain';
				break;
			case cmd.startsWith('/fix'):
				prompt = activeFile
					? `Fix any errors in ${activeFile.path}`
					: 'Please open a file to fix';
				break;
			case cmd.startsWith('/test'):
				prompt = activeFile
					? `Generate tests for ${activeFile.path}`
					: 'Please open a file to test';
				break;
			case cmd.startsWith('/optimize'):
				prompt = activeFile
					? `Optimize the code in ${activeFile.path}`
					: 'Please open a file to optimize';
				break;
			case cmd.startsWith('/document'):
				prompt = activeFile
					? `Add documentation to ${activeFile.path}`
					: 'Please open a file to document';
				break;
			case cmd.startsWith('/refactor'):
				prompt = activeFile
					? `Refactor the code in ${activeFile.path}`
					: 'Please open a file to refactor';
				break;
			case cmd.startsWith('/help'):
				// Toggle help section
				const helpToggle = document.querySelector(
					'.acp-help-toggle'
				) as HTMLButtonElement;
				if (helpToggle) {
					helpToggle.click();
				}
				return;
			case cmd.startsWith('/mode'):
				const parts = cmd.split(' ');
				if (parts.length > 1) {
					this.setMode(parts[1]);
				} else {
					this.displayMessage({
						role: 'system',
						content: [
							{
								type: 'text',
								text: `Available modes: ${this.availableModes.map((m) => m.id).join(', ')}`,
							},
						],
					});
				}
				this.inputField.value = '';
				return;
			default:
				prompt = `Unknown command: ${command}. Type /help for available commands.`;
		}

		this.inputField.value = prompt;
		this.autoResizeTextarea();

		// If it's a valid command with a file, send it automatically
		if (
			activeFile &&
			!prompt.startsWith('Unknown command') &&
			!prompt.startsWith('Please open')
		) {
			setTimeout(() => this.handleSendMessage(), 100);
		}
	}

	// ChatInterface implementation
	/**
	 * Handle streaming message chunks from the agent
	 */
	private handleStreamingChunk(sessionId: string, chunk: any): void {
		if (!chunk) return;
		if (sessionId !== this.currentSessionId) return;

		if (chunk.type === 'available_commands_update') {
			this.agentCommands = (chunk.commands || []).map((c: any) => ({
				description: c.description,
				name: `/${c.name}`,
				input: c.input,
			}));
			return;
		}

		if (chunk.type === 'mode') {
			this.currentModeId = chunk.modeId;
			this.updateModeSelector();
			return;
		}

		if (chunk.type === 'tool_call') {
			this.displayToolCall(chunk);
			return;
		}

		if (chunk.type === 'tool_call_update') {
			this.updateToolCallDisplay(chunk);
			return;
		}

		if (chunk.type !== 'text' || !chunk.text) {
			return;
		}

		// Find or create a streaming message container
		let streamingContainer = this.messagesContainer?.querySelector(
			'.streaming-message'
		) as HTMLElement;

		if (!streamingContainer) {
			// Create new streaming message container
			streamingContainer = this.messagesContainer.createDiv(
				'acp-message acp-message-assistant streaming-message'
			);

			const messageContent = streamingContainer.createDiv(
				'acp-message-content message-content'
			);
		}

		// Append the chunk text to the streaming message
		const messageContent = streamingContainer.querySelector(
			'.message-content'
		) as HTMLElement;
		if (messageContent) {
			// Append the new chunk
			messageContent.textContent =
				(messageContent.textContent || '') + chunk.text;

			// Auto-scroll to bottom
			this.scrollToBottom();
		}
	}

	/**
	 * Finalize streaming message (called when streaming is complete)
	 */
	private finalizeStreamingMessage(): void {
		const streamingContainer = this.messagesContainer?.querySelector(
			'.streaming-message'
		) as HTMLElement;

		if (streamingContainer) {
			// Remove streaming class to finalize the message
			streamingContainer.classList.remove('streaming-message');

			// Convert to proper markdown rendering
			const messageContent = streamingContainer.querySelector(
				'.message-content'
			) as HTMLElement;
			if (messageContent && messageContent.textContent) {
				const finalContent = messageContent.textContent;
				messageContent.innerHTML = '';
				messageContent.addClass('acp-markdown-content');
				this.renderMarkdownContent(finalContent, messageContent);
			}
		}
	}

	/**
	 * Display a message in the chat
	 */
	displayMessage(message: Message): void {
		const messageEl = this.messagesContainer.createDiv('acp-message');
		messageEl.addClass(`acp-message-${message.role}`);

		// Add timestamp if enabled
		const settings = (this.app as any).plugins?.plugins?.['acp-chat-assistant']
			?.settings;
		if (settings?.ui?.showTimestamps !== false) {
			const timestamp = messageEl.createDiv('acp-message-timestamp');
			timestamp.textContent = new Date().toLocaleTimeString();
		}

		// Add role indicator
		const roleEl = messageEl.createDiv('acp-message-role');
		roleEl.textContent =
			message.role.charAt(0).toUpperCase() + message.role.slice(1);

		// Add content
		const contentEl = messageEl.createDiv('acp-message-content');

		for (const block of message.content) {
			if (block.type === 'text' && block.text) {
				if (
					message.role === 'assistant' &&
					settings?.ui?.enableMarkdown !== false
				) {
					// Render markdown for assistant messages
					const markdownEl = contentEl.createDiv('acp-markdown-content');
					this.renderMarkdownContent(block.text, markdownEl);
				} else {
					// Plain text for user messages or when markdown is disabled
					const textEl = contentEl.createDiv('acp-text-content');
					textEl.textContent = block.text;
				}
			} else if (block.type === 'image' && block.data) {
				// Handle image content
				const imageEl = contentEl.createEl('img', {
					cls: 'acp-image-content',
					attr: {
						src: `data:${block.mimeType || 'image/png'};base64,${block.data}`,
						alt: 'Image content',
					},
				});
			} else if (block.type === 'resource' && block.source) {
				// Handle resource references
				const resourceEl = contentEl.createDiv('acp-resource-content');
				const linkEl = resourceEl.createEl('a', {
					text: `Resource: ${block.source}`,
					attr: { href: block.source },
				});
				linkEl.addClass('acp-resource-link');
			} else if (block.type === 'diff' && block.text) {
				// Handle diff content with basic syntax highlighting
				const diffEl = contentEl.createEl('pre', {
					cls: 'acp-diff-content',
				});
				const codeEl = diffEl.createEl('code', {
					text: block.text,
				});
				codeEl.addClass('language-diff');
			}
		}

		// Scroll to bottom
		this.scrollToBottom();
	}

	/**
	 * Display a new tool call in the chat
	 */
	private displayToolCall(chunk: any): void {
		this.finalizeStreamingMessage();

		// Create tool call container
		const toolCallId = chunk.toolCallId;

		// check if it already exists
		if (this.messagesContainer.querySelector(`#tool-call-${toolCallId}`)) {
			return;
		}

		const messageEl = this.messagesContainer.createDiv(
			'acp-message acp-message-system acp-permission-request-compact'
		);
		messageEl.id = `tool-call-${toolCallId}`;

		const contentEl = messageEl.createDiv('acp-permission-content-compact');

		// Icon based on status
		const iconSpan = contentEl.createSpan({ cls: 'acp-permission-icon' });
		setIcon(iconSpan, 'loader');

		const titleEl = contentEl.createSpan({
			text: chunk.title || `Tool: ${chunk.kind || 'Unknown'}`,
			cls: 'acp-permission-summary',
		});

		this.scrollToBottom();
	}

	/**
	 * Update an existing tool call in the chat
	 */
	private updateToolCallDisplay(chunk: any): void {
		const toolCallId = chunk.toolCallId;
		const messageEl = this.messagesContainer.querySelector(
			`#tool-call-${toolCallId}`
		) as HTMLElement;

		if (!messageEl) {
			// If we don't have it for some reason, create it
			this.displayToolCall(chunk);
			return;
		}

		const contentEl = messageEl.querySelector(
			'.acp-permission-content-compact'
		) as HTMLElement;
		const iconSpan = contentEl.querySelector(
			'.acp-permission-icon'
		) as HTMLElement;
		const titleEl = contentEl.querySelector(
			'.acp-permission-summary'
		) as HTMLElement;

		if (chunk.title) {
			titleEl.textContent = chunk.title;
		}

		if (chunk.status) {
			iconSpan.empty();

			switch (chunk.status) {
				case 'pending':
					setIcon(iconSpan, 'loader');
					break;
				case 'in_progress':
					setIcon(iconSpan, 'play-circle');
					break;
				case 'completed':
					setIcon(iconSpan, 'check-circle');
					break;
				case 'failed':
					setIcon(iconSpan, 'x-circle');
					break;
			}
		}
	}

	/**
	 * Append a permission request to the chat timeline
	 */
	async appendPermissionRequest(
		params: SessionRequestPermissionParams
	): Promise<string | null> {
		return new Promise((resolve) => {
			const toolCallId = params.toolCall.toolCallId;
			const wrappedResolve = (id: string | null) => {
				this.pendingPermissionResolvers.delete(toolCallId);
				resolve(id);
			};
			this.pendingPermissionResolvers.set(toolCallId, wrappedResolve);

			// Finalize any active streaming part so the permission request block
			// is inserted in the correct chronological position within the flow.
			this.finalizeStreamingMessage();

			const messageEl = this.messagesContainer.createDiv(
				'acp-message acp-message-system acp-permission-request-compact'
			);

			const contentEl = messageEl.createDiv('acp-permission-content-compact');

			// Icon
			setIcon(
				contentEl.createSpan({ cls: 'acp-permission-icon' }),
				'alert-triangle'
			);

			// Fetch full tool call context from session manager if available
			let fullToolCall = undefined;
			if (this.sessionManager) {
				const session = this.sessionManager.getSessionInfo(params.sessionId);
				if (session && session.toolCalls) {
					fullToolCall = session.toolCalls.get(params.toolCall.toolCallId);
				}
			}

			// Action description (Summary)
			const kind = fullToolCall?.kind || params.toolCall.kind || 'access';
			const resource =
				(fullToolCall?.locations && fullToolCall.locations.length > 0
					? fullToolCall.locations[0].path
					: null) ||
				params.toolCall.path ||
				params.toolCall.resource ||
				'unknown';
			const title =
				fullToolCall?.title || params.toolCall.title || 'Permission Request';

			const summaryText = title; // `${kind}: ${resource}`;
			const summaryEl = contentEl.createSpan({
				text: summaryText,
				cls: 'acp-permission-summary',
			});

			if (title) {
				summaryEl.title = title; // Show title as tooltip
			}

			const optionsContainer = messageEl.createDiv(
				'acp-permission-options-compact'
			);
			optionsContainer.style.marginTop = '4px';

			params.options.forEach((option) => {
				const btn = optionsContainer.createEl('button', {
					text: option.name,
					cls: `acp-permission-button-compact ${option.kind.startsWith('allow') ? 'mod-cta' : ''}`,
				});

				btn.addEventListener('click', () => {
					// Remove the permission request element entirely
					messageEl.remove();

					// Add a small indicator of what was selected to the tool call element
					const toolCallEl = this.messagesContainer.querySelector(
						`#tool-call-${params.toolCall.toolCallId}`
					);
					if (toolCallEl) {
						const toolCallContent = toolCallEl.querySelector(
							'.acp-permission-content-compact'
						);
						if (toolCallContent) {
							const selectionIndicator = toolCallContent.createSpan({
								cls: 'acp-permission-selection-compact',
							});
							selectionIndicator.textContent = `(${option.name})`;
						}
					}

					wrappedResolve(option.optionId);
				});
			});

			// Add a cancel button if not already in options
			const hasCancel = params.options.some((o) => o.kind.startsWith('reject'));
			if (!hasCancel) {
				const cancelBtn = optionsContainer.createEl('button', {
					text: 'Cancel',
					cls: 'acp-permission-button-compact',
				});
				cancelBtn.addEventListener('click', () => {
					// Remove the permission request element entirely
					messageEl.remove();

					const toolCallEl = this.messagesContainer.querySelector(
						`#tool-call-${params.toolCall.toolCallId}`
					);
					if (toolCallEl) {
						const toolCallContent = toolCallEl.querySelector(
							'.acp-permission-content-compact'
						);
						if (toolCallContent) {
							const selectionIndicator = toolCallContent.createSpan({
								cls: 'acp-permission-selection-compact',
							});
							selectionIndicator.textContent = `(Cancelled)`;
						}
					}
					wrappedResolve(null);
				});
			}

			this.scrollToBottom();
		});
	}

	private renderMarkdownContent(content: string, container: HTMLElement): void {
		// Use Obsidian's markdown renderer
		MarkdownRenderer.renderMarkdown(content, container, '', new Component());
	}

	renderMarkdown(content: string): HTMLElement {
		const container = document.createElement('div');
		this.renderMarkdownContent(content, container);
		return container;
	}

	async getUserInput(): Promise<string> {
		// This method is for programmatic input requests
		// For now, return empty string as user input is handled via the UI
		return '';
	}

	showConnectionStatus(status: ConnectionStatus): void {
		this.connectionStatus = status;
		this.updateInputState();

		// Reset session if connection status changed
		if (!status.connected && this.currentSessionId) {
			this.currentSessionId = null;
		}

		// // Proactively create session if connected
		if (status.connected && !this.currentSessionId && this.acpClient) {
			this.ensureSession().catch((err) =>
				console.error('Failed to proactively create session:', err)
			);
		}
	}

	private updateInputState(): void {
		if (!this.inputField || !this.sendButton) return;

		const isDisconnected = !this.connectionStatus.connected;
		const isInputEmpty = !this.inputField.value.trim();

		// Input field stays enabled whenever connected (Req 1.2)
		this.inputField.disabled = isDisconnected;

		// Send button disabled only when disconnected or (not processing and input empty) (Req 2.3)
		this.sendButton.disabled =
			isDisconnected || (!this.isProcessing && isInputEmpty);

		// Show cancel icon only when processing with empty queue (Req 2.1, 2.2)
		const isCancelMode = this.isProcessing && this.messageQueue.length === 0;
		setIcon(this.sendButton, isCancelMode ? 'square' : 'arrow-right');

		if (isDisconnected) {
			this.inputField.placeholder = 'Connect to an AI assistant';
		} else {
			this.inputField.placeholder = 'Type your message here...';
		}

		const hasMessages = this.getSessionMessages().length > 0;

		if (this.agentSelector) {
			this.agentSelector.disabled = isDisconnected;
			this.agentSelector.classList.add('is-readonly');
		}
		if (this.modeSelector) this.modeSelector.disabled = isDisconnected;
		if (this.modelSelector) this.modelSelector.disabled = isDisconnected;
	}

	private updateDocumentContextBox(): void {
		if (!this.documentContextBox) return;

		this.documentContextBox.empty();

		if (!this.activeFile) {
			this.documentContextBox.style.display = 'none';
			return;
		}

		this.documentContextBox.style.display = 'flex';

		const info = this.documentContextBox.createDiv('acp-document-info');
		info.createSpan({ text: this.activeFile.name, cls: 'acp-document-name' });

		const btn = this.documentContextBox.createEl('button', {
			cls: `acp-document-add-btn ${this.isDocumentAddedToContext ? 'is-added' : ''}`,
		});
		setIcon(btn, this.isDocumentAddedToContext ? 'x' : 'plus');

		btn.addEventListener('click', () => {
			this.isDocumentAddedToContext = !this.isDocumentAddedToContext;
			this.updateDocumentContextBox();
		});
	}

	private getAgentName(agentId?: string | null): string | undefined {
		if (!agentId) return undefined;

		if (this.acpClient) {
			const status = this.acpClient.getConnectionStatus(agentId);
			if (status.agentName) return status.agentName;
		}

		// Fallback to settings if agent is disconnected
		const settings = (this.app as any).plugins?.plugins?.['acp-chat-assistant']
			?.settings;
		if (settings?.agents) {
			const agent = settings.agents.find((a: any) => a.id === agentId);
			if (agent) return agent.name;
		}

		return agentId;
	}

	private updateAgentNameDisplay(): void {
		if (!this.agentNameEl) return;

		const agentName = this.getAgentName(this.currentAgentId) || 'None';
		this.agentNameEl.textContent = agentName;
	}

	private updateModeSelector(): void {
		if (!this.modeSelector) return;

		this.modeSelector.empty();

		if (this.availableModes.length === 0) {
			this.modeSelector.style.display = 'none';
			return;
		}

		this.modeSelector.style.display = 'block';

		this.availableModes.forEach((mode) => {
			const option = this.modeSelector?.createEl('option', {
				text: mode.name,
				value: mode.id,
			});
			if (option && mode.id === this.currentModeId) {
				option.selected = true;
			}
		});

		// Disable selector if not connected
		this.modeSelector.disabled = !this.connectionStatus.connected;
	}

	private async handleModeChange(): Promise<void> {
		if (!this.modeSelector || !this.sessionManager || !this.currentSessionId)
			return;

		const newModeId = this.modeSelector.value;
		try {
			await this.sessionManager.setMode(this.currentSessionId, newModeId);
			this.currentModeId = newModeId;
		} catch (error) {
			console.error('Failed to change mode:', error);
			// Revert selector to current mode
			this.updateModeSelector();
		}
	}

	async setMode(modeId: string): Promise<void> {
		const mode = this.availableModes.find(
			(m) => m.id === modeId || m.name.toLowerCase() === modeId.toLowerCase()
		);
		if (mode) {
			if (this.modeSelector) {
				this.modeSelector.value = mode.id;
				await this.handleModeChange();
			}
		} else {
			this.displayMessage({
				role: 'system',
				content: [
					{
						type: 'text',
						text: `Unknown mode: ${modeId}. Available modes: ${this.availableModes.map((m) => m.id).join(', ')}`,
					},
				],
			});
		}
	}

	private updateModelSelector(): void {
		if (!this.modelSelector) return;

		this.modelSelector.empty();

		if (this.availableModels.length === 0) {
			this.modelSelector.style.display = 'none';
			return;
		}

		this.modelSelector.style.display = 'block';

		this.availableModels.forEach((model) => {
			const optionVal = model.modelId || model.value || model.id;
			const option = this.modelSelector?.createEl('option', {
				text: model.name || optionVal,
				value: optionVal,
			});

			if (option && optionVal === this.currentModelId) {
				option.selected = true;
			}
			if (option && model.description) {
				option.title = model.description;
			}
		});

		this.modelSelector.disabled = !this.connectionStatus.connected;
	}

	private async handleModelChange(): Promise<void> {
		if (!this.modelSelector || !this.sessionManager || !this.currentSessionId)
			return;

		const newModelId = this.modelSelector.value;
		try {
			await this.sessionManager.setModel(this.currentSessionId, newModelId);
			this.currentModelId = newModelId;
		} catch (error) {
			console.error('Failed to change model:', error);
			this.updateModelSelector();
		}
	}

	private createCommandDropdown(container: HTMLElement): void {
		this.commandDropdown = container.createDiv('acp-dropdown');
		this.commandDropdown.style.display = 'none';

		this.renderCommandList(this.commands);

		// Close dropdown when clicking outside
		document.addEventListener('click', (e) => {
			if (
				this.commandDropdown &&
				!this.commandDropdown.contains(e.target as Node)
			) {
				this.hideCommandDropdown();
			}
		});
	}

	private showCommandDropdown(query: string): void {
		if (!this.commandDropdown) return;
		this.filteredCommands = this.commands.filter(
			(cmd) => cmd.name.toLowerCase().includes(query)
			// (cmd.description && cmd.description.toLowerCase().includes(query))
		);

		if (this.filteredCommands.length === 0) {
			this.hideCommandDropdown();
			return;
		}

		this.renderCommandList(this.filteredCommands);
		this.commandDropdown.style.display = 'block';
		this.selectedCommandIndex = 0;
		this.highlightSelectedCommand();
	}

	private hideCommandDropdown(): void {
		if (this.commandDropdown) {
			this.commandDropdown.style.display = 'none';
			this.selectedCommandIndex = -1;
		}
	}

	private renderCommandList(commands: AcpCommand[]): void {
		if (!this.commandDropdown) return;

		this.commandDropdown.empty();
		commands.forEach((action, index) => {
			const item = this.commandDropdown!.createDiv('acp-dropdown-item');

			// const text = item.createSpan('acp-dropdown-text');
			// text.textContent = action.text;

			if (action.name) {
				const cmdHint = item.createSpan('acp-dropdown-hint');
				cmdHint.textContent = action.name;
				cmdHint.style.marginLeft = 'auto';
				cmdHint.style.opacity = '0.5';
				cmdHint.style.fontSize = '0.8em';
			}

			item.addEventListener('click', (e) => {
				e.stopPropagation();
				this.selectCommand(action);
			});

			item.addEventListener('mouseenter', () => {
				this.selectedCommandIndex = index;
				this.highlightSelectedCommand();
			});
		});
	}

	private highlightSelectedCommand(): void {
		if (!this.commandDropdown) return;

		const items = this.commandDropdown.querySelectorAll('.acp-dropdown-item');
		items.forEach((item, index) => {
			if (index === this.selectedCommandIndex) {
				item.addClass('is-selected');
				item.scrollIntoView({ block: 'nearest' });
			} else {
				item.removeClass('is-selected');
			}
		});
	}

	private navigateCommandDropdown(direction: number): void {
		if (!this.commandDropdown || this.filteredCommands.length === 0) return;

		this.selectedCommandIndex =
			(this.selectedCommandIndex + direction + this.filteredCommands.length) %
			this.filteredCommands.length;
		this.highlightSelectedCommand();
	}

	private selectCommand(action: any): void {
		if (action.name) {
			this.inputField.value = action.name + ' ';
			this.autoResizeTextarea();
			this.inputField.focus();
		}
		this.hideCommandDropdown();
	}

	private async startNewConversation(): Promise<void> {
		if (!this.acpClient) return;

		const connectedAgentIds = this.acpClient.getConnectedAgents();

		if (connectedAgentIds.length === 0) {
			new Notice('No agents connected');
			return;
		}

		if (connectedAgentIds.length === 1) {
			await this.initializeNewConversation(connectedAgentIds[0]);
		} else {
			const agents = connectedAgentIds.map((id) => ({
				id,
				status: this.acpClient!.getConnectionStatus(id),
			}));
			const modal = new AgentSuggestModal(this.app, agents, async (agentId) => {
				await this.initializeNewConversation(agentId);
			});
			modal.open();
		}
	}

	private async initializeNewConversation(agentId: string): Promise<void> {
		this.currentAgentId = agentId;
		// Reset session state so a fresh session is created
		this.ensureSessionPromise = null;
		this.currentSessionId = null;
		// Discard queued messages from the old session (Req 1.7)
		this.messageQueue = [];
		this.updateQueueIndicator();
		// Remove any in-progress streaming element before clearing the container (Req 3.4)
		const streamingEl = this.messagesContainer?.querySelector('.streaming-message');
		if (streamingEl) {
			streamingEl.remove();
		}
		this.agentCommands = [];
		this.messagesContainer.empty();
		this.updateAgentNameDisplay();
		await this.ensureSession();
		this.scrollToBottom();
		this.updateInputState();
		new Notice(`Started new conversation with ${this.currentAgentId}`);
	}

	private showSessionHistory(): void {
		if (!this.sessionManager) return;

		const sessions = this.sessionManager.getActiveSessions();
		if (sessions.length === 0) {
			new Notice('No past conversations found');
			return;
		}

		const modal = new SessionSuggestModal(
			this.app,
			sessions,
			this.acpClient,
			(sessionId) => this.loadSession(sessionId)
		);
		modal.open();
	}

	private async loadSession(sessionId: string): Promise<void> {
		if (!this.sessionManager) return;

		const session = this.sessionManager.getSessionInfo(sessionId);
		if (!session) return;

		this.currentSessionId = sessionId;
		this.currentAgentId = session.agentId;
		this.updateAgentNameDisplay();
		this.messagesContainer.empty();

		// Re-render all messages from session
		session.messages.forEach((msg) => {
			const displayMsg = this.cleanMessageForDisplay(msg);
			this.displayMessage(displayMsg);
		});

		// Update modes
		if (session.modes) {
			this.availableModes = session.modes.availableModes;
			this.currentModeId = session.modes.currentModeId;
			this.updateModeSelector();
		}

		if (session.availableCommands) {
			this.agentCommands = session.availableCommands.map((c) => ({
				description: c.description,
				name: `/${c.name}`,
				input: c.input,
			}));
		} else {
			this.agentCommands = [];
		}

		this.scrollToBottom();
		new Notice('Switched to conversation');
	}

	private scrollToBottom(): void {
		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}

	// Public methods for external control
	clearMessages(): void {
		this.messagesContainer.empty();
	}

	private cancelPendingPermissions(): void {
		for (const [toolCallId, resolver] of this.pendingPermissionResolvers) {
			// Remove the pending permission UI element
			const permissionEl = this.messagesContainer.querySelector(
				`.acp-permission-request-compact:not([id])`
			);
			permissionEl?.remove();

			// Mark the tool call as cancelled
			const toolCallEl = this.messagesContainer.querySelector(
				`#tool-call-${toolCallId}`
			);
			if (toolCallEl) {
				const iconSpan = toolCallEl.querySelector(
					'.acp-permission-icon'
				) as HTMLElement;
				if (iconSpan) {
					iconSpan.empty();
					setIcon(iconSpan, 'x-circle');
				}
				const content = toolCallEl.querySelector(
					'.acp-permission-content-compact'
				);
				if (content) {
					const indicator = content.createSpan({
						cls: 'acp-permission-selection-compact',
					});
					indicator.textContent = '(Cancelled)';
				}
			}

			resolver(null);
		}
	}

	private getSessionMessages(): Message[] {
		if (!this.currentSessionId || !this.sessionManager) return [];
		return (
			this.sessionManager.getSessionInfo(this.currentSessionId)?.messages ?? []
		);
	}

	focusInput(): void {
		this.inputField?.focus();
	}

	/**
	 * Cleans a message for UI display only (e.g. stripping context preambles)
	 */
	private cleanMessageForDisplay(message: Message): Message {
		if (message.role !== 'user') return message;

		return {
			...message,
			content: message.content.map((block) => {
				if (block.type === 'text' && block.text) {
					return {
						...block,
						text: block.text.replace(/^Current document: .*\n\n/, ''),
					};
				}
				return block;
			}),
		};
	}
}

/**
 * Modal to suggest and switch between active sessions
 */
class SessionSuggestModal extends SuggestModal<SessionContext> {
	private sessions: SessionContext[];
	private onSelect: (sessionId: string) => void;
	private acpClient: ACPClientImpl | null;

	constructor(
		app: App,
		sessions: SessionContext[],
		acpClient: ACPClientImpl | null,
		onSelect: (sessionId: string) => void
	) {
		super(app);
		this.sessions = sessions
			.filter((s) => s.messages.length > 0)
			.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
		this.acpClient = acpClient;
		this.onSelect = onSelect;
	}

	getSuggestions(query: string): SessionContext[] {
		return this.sessions.filter((session) => {
			const firstMsg = this.getSessionPreview(session);
			return (
				session.sessionId.toLowerCase().includes(query.toLowerCase()) ||
				firstMsg.toLowerCase().includes(query.toLowerCase())
			);
		});
	}

	renderSuggestion(session: SessionContext, el: HTMLElement) {
		const preview = this.getSessionPreview(session);
		const container = el.createDiv('acp-session-suggestion');

		// Row 1: Session Preview
		container.createDiv({ text: preview, cls: 'acp-session-title' });

		const meta = container.createDiv('acp-session-meta');

		// Agent Name (from ACP Client if available)
		let agentName = session.agentId;
		if (this.acpClient) {
			const status = this.acpClient
				.getAllConnectionStatuses()
				.get(session.agentId);
			if (status?.agentName) {
				agentName = status.agentName;
			}
		}

		meta.createSpan({
			text: `Agent: ${agentName}`,
			cls: 'acp-session-agent',
		});

		meta.createSpan({
			text: ` | ${session.lastActivity.toLocaleString()}`,
			cls: 'acp-session-time',
		});

		meta.createSpan({
			text: ` | ID: ${session.sessionId.substring(0, 8)}...`,
			cls: 'acp-session-id',
		});
	}

	onChooseSuggestion(session: SessionContext, evt: MouseEvent | KeyboardEvent) {
		this.onSelect(session.sessionId);
	}

	private getSessionPreview(session: SessionContext): string {
		const firstUserMsg = session.messages.find((m) => m.role === 'user');
		if (
			!firstUserMsg ||
			!firstUserMsg.content ||
			firstUserMsg.content.length === 0
		)
			return 'Empty Conversation';

		let text =
			firstUserMsg.content.find((c) => c.type === 'text')?.text ||
			'Untitled Session';
		// Clean preview text
		text = text.replace(/^Current document: .*\n\n/, '');

		return text.substring(0, 60) + (text.length > 60 ? '...' : '');
	}
}

/**
 * Modal to suggest and select agents for a new session
 */
class AgentSuggestModal extends SuggestModal<{
	id: string;
	status: ConnectionStatus;
}> {
	private agents: { id: string; status: ConnectionStatus }[];
	private onSelect: (agentId: string) => Promise<void>;

	constructor(
		app: App,
		agents: { id: string; status: ConnectionStatus }[],
		onSelect: (agentId: string) => Promise<void>
	) {
		super(app);
		this.agents = agents;
		this.onSelect = onSelect;
		this.setPlaceholder('Select an agent for the new conversation');
	}

	getSuggestions(query: string): { id: string; status: ConnectionStatus }[] {
		return this.agents.filter(
			(agent) =>
				agent.id.toLowerCase().includes(query.toLowerCase()) ||
				(agent.status.agentName &&
					agent.status.agentName.toLowerCase().includes(query.toLowerCase()))
		);
	}

	renderSuggestion(
		agent: { id: string; status: ConnectionStatus },
		el: HTMLElement
	) {
		const container = el.createDiv('acp-agent-suggestion');
		container.createDiv({
			text: agent.status.agentName || agent.id,
			cls: 'acp-agent-title',
		});
		if (agent.status.capabilities) {
			const caps = container.createDiv('acp-agent-meta');
			caps.setText(agent.status.capabilities.slice(0, 3).join(', ') + '...');
		}
	}

	onChooseSuggestion(
		agent: { id: string; status: ConnectionStatus },
		evt: MouseEvent | KeyboardEvent
	) {
		this.onSelect(agent.id);
	}
}
