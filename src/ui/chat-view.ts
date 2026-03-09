/**
 * Chat View Component
 * Implements the dockable chat panel for Obsidian using ItemView
 */

import { ItemView, WorkspaceLeaf, MarkdownRenderer, Component, setIcon, SuggestModal, App, Notice } from 'obsidian';
import { Message, ConnectionStatus, SessionRequestPermissionParams } from '../types/acp';
import { ChatInterface } from '../interfaces/chat-interface';
import { ACPClientImpl } from '../core/acp-client-impl';
import { SessionManagerImpl, SessionContext } from '../core/session-manager';

export const CHAT_VIEW_TYPE = 'acp-chat-view';

export class ChatView extends ItemView implements ChatInterface {
  private messagesContainer: HTMLElement;
  private inputContainer: HTMLElement;
  private inputField: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private statusIndicator: HTMLElement;
  private connectionStatus: ConnectionStatus = { connected: false };
  private messageHistory: Message[] = [];
  private acpClient: ACPClientImpl | null = null;
  private sessionManager: SessionManagerImpl | null = null;
  private currentSessionId: string | null = null;
  private availableModes: any[] = [];
  private currentModeId: string | null = null;
  private modeSelector: HTMLSelectElement | null = null;
  private agentSelector: HTMLSelectElement | null = null;
  private currentAgentId: string | null = null;
  private documentContextBox: HTMLElement | null = null;
  private activeFile: any | null = null;
  private isDocumentAddedToContext: boolean = false;
  private commandDropdown: HTMLElement | null = null;
  private selectedCommandIndex: number = -1;
  private filteredCommands: any[] = [];
  private readonly commands = [
    { text: 'Explain code', command: '/explain' },
    { text: 'Fix errors', command: '/fix' },
    { text: 'Add tests', command: '/test' },
    { text: 'Optimize', command: '/optimize' },
    { text: 'Document', command: '/document' },
    { text: 'Refactor', command: '/refactor' },
    { text: 'File operations', prompt: 'What file operations can you help me with?' },
    { text: 'Search code', prompt: 'How can you help me search through my codebase?' },
    { text: 'Web search', prompt: 'How can you help with web search and research?' }
  ];

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
      this.ensureSession().catch(err => console.error("Failed to ensure session on open:", err));
    }
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
      }
    });
    
    // Connect session manager to ACP client for streaming updates
    client.setSessionManager(this.sessionManager);
    
    // Don't set JSON-RPC client here - we'll set it when needed
  }

  private async ensureSession(): Promise<string> {
    if (!this.sessionManager || !this.acpClient) {
      throw new Error('Session manager or ACP client not initialized');
    }

    // Ensure we have a JSON-RPC client from a connected agent
    const jsonRpcClient = this.getConnectedJsonRpcClient();
    if (!jsonRpcClient) {
      throw new Error('No connected agents available');
    }

    // Set the JSON-RPC client on the session manager
    this.sessionManager.setJsonRpcClient(jsonRpcClient);

    if (!this.currentSessionId) {
      // Use the vault path as the working directory
      // @ts-ignore
      const vaultPath = this.app.vault.adapter.basePath || process.cwd();
      console.log({vaultPath})
      const session = await this.sessionManager.createSession(vaultPath);
      this.currentSessionId = session.sessionId;
      
      // Store modes from session result
      const sessionInfo = this.sessionManager.getSessionInfo(this.currentSessionId);
      if (sessionInfo && sessionInfo.modes) {
        this.availableModes = sessionInfo.modes.availableModes;
        this.currentModeId = sessionInfo.modes.currentModeId;
        this.updateModeSelector();
      }
    }

    return this.currentSessionId;
  }

  private getConnectedJsonRpcClient(): any {
    if (!this.acpClient) {
      return null;
    }

    // Use the selected agent or the first available one
    let connection;
    if (this.currentAgentId) {
      const connections = (this.acpClient as any).connections;
      connection = connections?.get(this.currentAgentId);
    }
    
    if (!connection) {
      connection = (this.acpClient as any).getFirstAvailableConnection();
    }
    
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

    this.updateAgentSelector();
  }

  private createChatInterface(container: Element): void {
    // Create main chat layout
    const chatWrapper = container.createDiv('acp-chat-wrapper');

    // Header section for session management
    const header = chatWrapper.createDiv('acp-chat-header');
    
    // New Session button
    const newSessionBtn = header.createEl('button', {
      cls: 'acp-header-btn',
      title: 'New Conversation'
    });
    setIcon(newSessionBtn, 'plus-circle');
    newSessionBtn.addEventListener('click', () => this.startNewConversation());

    // Session History button
    const historyBtn = header.createEl('button', {
      cls: 'acp-header-btn',
      title: 'Session History'
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
        placeholder: 'Ask me anything about your code, files, or development tasks...',
        rows: '1'
      }
    });

    // Selection row (Agent and Auto/Modality)
    const selectorsRow = this.inputContainer.createDiv('acp-selectors-row');
    
    // Agent dropdown
    const agentContainer = selectorsRow.createDiv('acp-selector-wrapper');
    agentContainer.createSpan({ text: 'Agent:', cls: 'acp-selector-label' });
    this.agentSelector = agentContainer.createEl('select', {
      cls: 'acp-agent-selector'
    });
    this.agentSelector.addEventListener('change', () => {
      this.currentAgentId = this.agentSelector!.value;
      this.updateAgentSelector(); // Re-sync session if needed
      this.currentSessionId = null; // Reset session when switching agent
    });

    // Auto/Mode selector
    const modalityContainer = selectorsRow.createDiv('acp-selector-wrapper');
    modalityContainer.createSpan({ text: 'Mode:', cls: 'acp-selector-label' });
    this.modeSelector = modalityContainer.createEl('select', {
      cls: 'acp-mode-selector'
    });
    this.modeSelector.addEventListener('change', () => {
      this.handleModeChange();
    });
    // Enhanced send button with dropdown
    const sendButtonContainer = inputRow.createDiv('acp-send-container');
    
    this.sendButton = selectorsRow.createEl('button', {
      cls: 'acp-send-button'
    });
    setIcon(this.sendButton, 'arrow-right');

    this.createCommandDropdown(sendButtonContainer);

    this.updateModeSelector();
    this.updateAgentSelector();
    this.updateInputState();
  }

  private setupEventListeners(): void {
    // Send button click
    this.sendButton.addEventListener('click', () => {
      this.handleSendMessage();
    });

    // Enter key to send (Shift+Enter for new line)
    this.inputField.addEventListener('keydown', (event) => {
      // Handle command dropdown navigation
      if (this.commandDropdown && this.commandDropdown.style.display !== 'none') {
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
            this.selectCommand(this.filteredCommands[this.selectedCommandIndex]);
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
      if (value.startsWith('/') && cursorPosition <= value.split('\n')[0].length) {
        const query = value.substring(1).toLowerCase();
        this.showCommandDropdown(query);
      } else {
        this.hideCommandDropdown();
      }
    });
  }

  private autoResizeTextarea(): void {
    this.inputField.style.height = 'auto';
    this.inputField.style.height = Math.min(this.inputField.scrollHeight, 120) + 'px';
  }

  private async handleSendMessage(): Promise<void> {
    const text = this.inputField.value.trim();
    if (!text || !this.connectionStatus.connected) {
      return;
    }

    // Check for slash commands
    if (text.startsWith('/')) {
      this.handleSlashCommand(text);
      return;
    }

    // Clear input
    this.inputField.value = '';
    this.autoResizeTextarea();
    this.updateInputState();

    // Create user message
    let finalPrompt = text;
    
    // Prepend document context if added and it's the first message
    if (this.isDocumentAddedToContext && this.activeFile && this.messageHistory.length === 0) {
      finalPrompt = `Current document: ${this.activeFile.path}\n\n${text}`;
    }

    const userMessageForAgent: Message = {
      role: 'user',
      content: [{ type: 'text', text: finalPrompt }]
    };

    const userMessageForUI: Message = {
      role: 'user',
      content: [{ type: 'text', text: text }]
    };

    // Display user message in UI (this stores the 'clean' version in history)
    this.displayMessage(userMessageForUI);

    // Send message via ACP protocol
    try {
      if (!this.sessionManager) {
        throw new Error('Session manager not initialized');
      }

      const sessionId = await this.ensureSession();
      console.log({userMessageForAgent});
      const result = await this.sessionManager.sendPrompt(sessionId, [userMessageForAgent]);
      console.log({result})
      
      // Finalize any streaming message that was being displayed
      this.finalizeStreamingMessage();
      
      // Note: We don't display result.message here because the actual content
      // was already streamed via handleStreamingChunk. The result just contains
      // metadata like stopReason.
      
    } catch (error) {
      console.error('Failed to send message:', error);
      
      // Finalize any partial streaming message
      this.finalizeStreamingMessage();
      
      // Display error message to user
      const errorMessage: Message = {
        role: 'assistant',
        content: [{ 
          type: 'text', 
          text: `Error: Failed to send message. ${error.message || 'Unknown error'}` 
        }]
      };
      this.displayMessage(errorMessage);
    }
  }

  private handleSlashCommand(command: string): void {
    const cmd = command.toLowerCase();
    const activeFile = this.app.workspace.getActiveFile();
    
    let prompt = '';
    
    switch (true) {
      case cmd.startsWith('/explain'):
        prompt = activeFile ? `Explain the code in ${activeFile.path}` : 'Please open a file to explain';
        break;
      case cmd.startsWith('/fix'):
        prompt = activeFile ? `Fix any errors in ${activeFile.path}` : 'Please open a file to fix';
        break;
      case cmd.startsWith('/test'):
        prompt = activeFile ? `Generate tests for ${activeFile.path}` : 'Please open a file to test';
        break;
      case cmd.startsWith('/optimize'):
        prompt = activeFile ? `Optimize the code in ${activeFile.path}` : 'Please open a file to optimize';
        break;
      case cmd.startsWith('/document'):
        prompt = activeFile ? `Add documentation to ${activeFile.path}` : 'Please open a file to document';
        break;
      case cmd.startsWith('/refactor'):
        prompt = activeFile ? `Refactor the code in ${activeFile.path}` : 'Please open a file to refactor';
        break;
      case cmd.startsWith('/help'):
        // Toggle help section
        const helpToggle = document.querySelector('.acp-help-toggle') as HTMLButtonElement;
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
            content: [{ type: 'text', text: `Available modes: ${this.availableModes.map(m => m.id).join(', ')}` }]
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
    if (activeFile && !prompt.startsWith('Unknown command') && !prompt.startsWith('Please open')) {
      setTimeout(() => this.handleSendMessage(), 100);
    }
  }

  // ChatInterface implementation
  /**
   * Handle streaming message chunks from the agent
   */
  private handleStreamingChunk(sessionId: string, chunk: any): void {
    if (!chunk) return;

    if (chunk.type === 'mode') {
      this.currentModeId = chunk.modeId;
      this.updateModeSelector();
      return;
    }

    if (chunk.type !== 'text' || !chunk.text) {
      return;
    }

    // Find or create a streaming message container
    let streamingContainer = this.messagesContainer?.querySelector('.streaming-message') as HTMLElement;
    
    if (!streamingContainer) {
      // Create new streaming message container
      streamingContainer = this.messagesContainer.createDiv('acp-message acp-message-assistant streaming-message');
      
      const messageContent = streamingContainer.createDiv('acp-message-content');
      messageContent.className = 'message-content';
    }

    // Append the chunk text to the streaming message
    const messageContent = streamingContainer.querySelector('.message-content') as HTMLElement;
    if (messageContent) {
      // Append the new chunk
      messageContent.textContent = (messageContent.textContent || '') + chunk.text;
      
      // Auto-scroll to bottom
      this.scrollToBottom();
    }
  }

  /**
   * Finalize streaming message (called when streaming is complete)
   */
  private finalizeStreamingMessage(): void {
    const streamingContainer = this.messagesContainer?.querySelector('.streaming-message') as HTMLElement;
    
    if (streamingContainer) {
      // Remove streaming class to finalize the message
      streamingContainer.classList.remove('streaming-message');
      
      // Convert to proper markdown rendering
      const messageContent = streamingContainer.querySelector('.message-content') as HTMLElement;
      if (messageContent && messageContent.textContent) {
        const finalContent = messageContent.textContent;
        messageContent.innerHTML = '';
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
    const settings = (this.app as any).plugins?.plugins?.['acp-chat-plugin']?.settings;
    if (settings?.ui?.showTimestamps !== false) {
      const timestamp = messageEl.createDiv('acp-message-timestamp');
      timestamp.textContent = new Date().toLocaleTimeString();
    }

    // Add role indicator
    const roleEl = messageEl.createDiv('acp-message-role');
    roleEl.textContent = message.role.charAt(0).toUpperCase() + message.role.slice(1);

    // Add content
    const contentEl = messageEl.createDiv('acp-message-content');
    
    for (const block of message.content) {
      if (block.type === 'text' && block.text) {
        if (message.role === 'assistant' && settings?.ui?.enableMarkdown !== false) {
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
            alt: 'Image content'
          }
        });
      } else if (block.type === 'resource' && block.source) {
        // Handle resource references
        const resourceEl = contentEl.createDiv('acp-resource-content');
        const linkEl = resourceEl.createEl('a', {
          text: `Resource: ${block.source}`,
          attr: { href: block.source }
        });
        linkEl.addClass('acp-resource-link');
      } else if (block.type === 'diff' && block.text) {
        // Handle diff content with basic syntax highlighting
        const diffEl = contentEl.createEl('pre', {
          cls: 'acp-diff-content'
        });
        const codeEl = diffEl.createEl('code', {
          text: block.text
        });
        codeEl.addClass('language-diff');
      }
    }

    // Store in history
    this.messageHistory.push(message);

    // Scroll to bottom
    this.scrollToBottom();
  }

  /**
   * Append a permission request to the chat timeline
   */
  async appendPermissionRequest(params: SessionRequestPermissionParams): Promise<string | null> {
    return new Promise((resolve) => {
      // Finalize any active streaming part so the permission request block 
      // is inserted in the correct chronological position within the flow.
      this.finalizeStreamingMessage();

      const messageEl = this.messagesContainer.createDiv('acp-message acp-message-system acp-permission-request-compact');
      
      const contentEl = messageEl.createDiv('acp-permission-content-compact');
      
      // Icon
      setIcon(contentEl.createSpan({ cls: 'acp-permission-icon' }), 'alert-triangle');

      // Action description (Summary)
      const summaryText = params.operation && params.resource ? 
        `${params.operation}: ${params.resource}` : 
        (params.toolCall?.title || 'Permission Request');
      
      const summaryEl = contentEl.createSpan({ text: summaryText, cls: 'acp-permission-summary' });
      if (params.reason) {
        summaryEl.title = params.reason; // Show reason as tooltip
      }

      const optionsContainer = contentEl.createDiv('acp-permission-options-compact');
      
      params.options.forEach(option => {
        const btn = optionsContainer.createEl('button', {
          text: option.name,
          cls: `acp-permission-button-compact ${option.kind.startsWith('allow') ? 'mod-cta' : ''}`
        });
        
        btn.addEventListener('click', () => {
          // Hide all buttons in this request
          optionsContainer.style.display = 'none';
          
          // Add a small indicator of what was selected
          const selectionIndicator = contentEl.createSpan({ cls: 'acp-permission-selection-compact' });
          selectionIndicator.textContent = `(${option.name})`;
          
          resolve(option.optionId);
        });
      });

      // Add a cancel button if not already in options
      const hasCancel = params.options.some(o => o.kind.startsWith('reject'));
      if (!hasCancel) {
        const cancelBtn = optionsContainer.createEl('button', {
          text: 'Cancel',
          cls: 'acp-permission-button-compact'
        });
        cancelBtn.addEventListener('click', () => {
           optionsContainer.style.display = 'none';
           const selectionIndicator = contentEl.createSpan({ cls: 'acp-permission-selection-compact' });
           selectionIndicator.textContent = `(Cancelled)`;
           resolve(null);
        });
      }

      this.scrollToBottom();
    });
  }

  private renderMarkdownContent(content: string, container: HTMLElement): void {
    // Use Obsidian's markdown renderer
    MarkdownRenderer.renderMarkdown(
      content,
      container,
      '',
      new Component()
    );
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

    // Proactively create session if connected
    if (status.connected && !this.currentSessionId && this.acpClient) {
      this.ensureSession().catch(err => console.error("Failed to proactively create session:", err));
    }
  }


  private updateInputState(): void {
    if (!this.inputField || !this.sendButton) return;

    const isDisconnected = !this.connectionStatus.connected;
    const isInputEmpty = !this.inputField.value.trim();
    
    this.inputField.disabled = isDisconnected;
    this.sendButton.disabled = isDisconnected || isInputEmpty;

    if (isDisconnected) {
      this.inputField.placeholder = 'Connect to an AI assistant';
    } else {
      this.inputField.placeholder = 'Type your message here...';
    }
    
    if (this.agentSelector) this.agentSelector.disabled = isDisconnected;
    if (this.modeSelector) this.modeSelector.disabled = isDisconnected;
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
      cls: `acp-document-add-btn ${this.isDocumentAddedToContext ? 'is-added' : ''}`
    });
    setIcon(btn, this.isDocumentAddedToContext ? 'x' : 'plus');

    btn.addEventListener('click', () => {
      this.isDocumentAddedToContext = !this.isDocumentAddedToContext;
      this.updateDocumentContextBox();
    });
  }

  private updateAgentSelector(): void {
    if (!this.agentSelector || !this.acpClient) return;

    const connectedAgentIds = this.acpClient.getConnectedAgents();
    
    this.agentSelector.empty();
    
    if (connectedAgentIds.length === 0) {
      this.agentSelector.createEl('option', { text: 'No agents connected', value: '' });
      this.currentAgentId = null;
      return;
    }

    connectedAgentIds.forEach(id => {
      const status = this.acpClient!.getConnectionStatus(id);
      const option = this.agentSelector?.createEl('option', {
        text: status.agentName || id,
        value: id
      });
      if (option && id === this.currentAgentId) {
        option.selected = true;
      }
    });

    if (!this.currentAgentId && connectedAgentIds.length > 0) {
      this.currentAgentId = connectedAgentIds[0];
    }
  }

  private updateModeSelector(): void {
    if (!this.modeSelector) return;

    this.modeSelector.empty();
    
    if (this.availableModes.length === 0) {
      this.modeSelector.style.display = 'none';
      return;
    }

    this.modeSelector.style.display = 'block';
    
    this.availableModes.forEach(mode => {
      const option = this.modeSelector?.createEl('option', {
        text: mode.name,
        value: mode.id
      });
      if (option && mode.id === this.currentModeId) {
        option.selected = true;
      }
    });

    // Disable selector if not connected
    this.modeSelector.disabled = !this.connectionStatus.connected;
  }

  private async handleModeChange(): Promise<void> {
    if (!this.modeSelector || !this.sessionManager || !this.currentSessionId) return;
    
    const newModeId = this.modeSelector.value;
    try {
      await this.sessionManager.setMode(this.currentSessionId, newModeId);
      this.currentModeId = newModeId;
      console.log(`Switched to mode: ${newModeId}`);
    } catch (error) {
      console.error('Failed to change mode:', error);
      // Revert selector to current mode
      this.updateModeSelector();
    }
  }

  async setMode(modeId: string): Promise<void> {
    const mode = this.availableModes.find(m => m.id === modeId || m.name.toLowerCase() === modeId.toLowerCase());
    if (mode) {
      if (this.modeSelector) {
        this.modeSelector.value = mode.id;
        await this.handleModeChange();
      }
    } else {
      this.displayMessage({
        role: 'system',
        content: [{ type: 'text', text: `Unknown mode: ${modeId}. Available modes: ${this.availableModes.map(m => m.id).join(', ')}` }]
      });
    }
  }

  private createCommandDropdown(container: HTMLElement): void {
    this.commandDropdown = container.createDiv('acp-dropdown');
    this.commandDropdown.style.display = 'none';

    this.renderCommandList(this.commands);

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (this.commandDropdown && !this.commandDropdown.contains(e.target as Node)) {
        this.hideCommandDropdown();
      }
    });
  }

  private showCommandDropdown(query: string): void {
    if (!this.commandDropdown) return;

    this.filteredCommands = this.commands.filter(cmd => 
      cmd.text.toLowerCase().includes(query) || 
      (cmd.command && cmd.command.toLowerCase().includes(query))
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

  private renderCommandList(commands: any[]): void {
    if (!this.commandDropdown) return;
    
    this.commandDropdown.empty();
    commands.forEach((action, index) => {
      const item = this.commandDropdown!.createDiv('acp-dropdown-item');
      
      const text = item.createSpan('acp-dropdown-text');
      text.textContent = action.text;

      if (action.command) {
        const cmdHint = item.createSpan('acp-dropdown-hint');
        cmdHint.textContent = action.command;
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
    
    this.selectedCommandIndex = (this.selectedCommandIndex + direction + this.filteredCommands.length) % this.filteredCommands.length;
    this.highlightSelectedCommand();
  }

  private selectCommand(action: any): void {
    if (action.command) {
      this.inputField.value = action.command + ' ';
      // If we want to auto-execute, we can call handleSlashCommand here
      // But usually it's better to just fill the input
      this.handleSlashCommand(action.command);
    } else if (action.prompt) {
      this.inputField.value = action.prompt;
      this.autoResizeTextarea();
      this.inputField.focus();
    }
    this.hideCommandDropdown();
    this.autoResizeTextarea();
  }





  private async startNewConversation(): Promise<void> {
    this.currentSessionId = null;
    this.messageHistory = [];
    this.messagesContainer.empty();
    await this.ensureSession();
    this.scrollToBottom();
    new Notice('Started new conversation');
  }

  private showSessionHistory(): void {
    if (!this.sessionManager) return;
    
    const sessions = this.sessionManager.getActiveSessions();
    if (sessions.length === 0) {
      new Notice('No past conversations found');
      return;
    }

    const modal = new SessionSuggestModal(this.app, sessions, (sessionId) => this.loadSession(sessionId));
    modal.open();
  }

  private async loadSession(sessionId: string): Promise<void> {
    if (!this.sessionManager) return;
    
    const session = this.sessionManager.getSessionInfo(sessionId);
    if (!session) return;

    this.currentSessionId = sessionId;
    this.messageHistory = []; // Reset locally and rebuild from session
    this.messagesContainer.empty();

    // Re-render all messages from session
    session.messages.forEach(msg => {
      const displayMsg = this.cleanMessageForDisplay(msg);
      this.displayMessage(displayMsg);
    });

    // Update modes
    if (session.modes) {
      this.availableModes = session.modes.availableModes;
      this.currentModeId = session.modes.currentModeId;
      this.updateModeSelector();
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
    this.messageHistory = [];
  }

  getMessageHistory(): Message[] {
    return [...this.messageHistory];
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
      content: message.content.map(block => {
        if (block.type === 'text' && block.text) {
          return {
            ...block,
            text: block.text.replace(/^Current document: .*\n\n/, '')
          };
        }
        return block;
      })
    };
  }
}

/**
 * Modal to suggest and switch between active sessions
 */
class SessionSuggestModal extends SuggestModal<SessionContext> {
  private sessions: SessionContext[];
  private onSelect: (sessionId: string) => void;

  constructor(app: App, sessions: SessionContext[], onSelect: (sessionId: string) => void) {
    super(app);
    this.sessions = sessions.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
    this.onSelect = onSelect;
  }

  getSuggestions(query: string): SessionContext[] {
    return this.sessions.filter((session) => {
      const firstMsg = this.getSessionPreview(session);
      return session.sessionId.toLowerCase().includes(query.toLowerCase()) || 
             firstMsg.toLowerCase().includes(query.toLowerCase());
    });
  }

  renderSuggestion(session: SessionContext, el: HTMLElement) {
    const preview = this.getSessionPreview(session);
    const container = el.createDiv('acp-session-suggestion');
    container.createDiv({ text: preview, cls: "acp-session-title" });
    const meta = container.createDiv('acp-session-meta');
    meta.createSpan({ text: session.lastActivity.toLocaleString(), cls: "acp-session-time" });
    meta.createSpan({ text: ` | ID: ${session.sessionId.substring(0, 8)}...`, cls: "acp-session-id" });
  }

  onChooseSuggestion(session: SessionContext, evt: MouseEvent | KeyboardEvent) {
    this.onSelect(session.sessionId);
  }

  private getSessionPreview(session: SessionContext): string {
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    if (!firstUserMsg || !firstUserMsg.content || firstUserMsg.content.length === 0) return 'Empty Conversation';
    
    let text = firstUserMsg.content.find(c => c.type === 'text')?.text || 'Untitled Session';
    // Clean preview text
    text = text.replace(/^Current document: .*\n\n/, '');
    
    return text.substring(0, 60) + (text.length > 60 ? '...' : '');
  }
}