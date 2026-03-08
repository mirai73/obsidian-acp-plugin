/**
 * Chat View Component
 * Implements the dockable chat panel for Obsidian using ItemView
 */

import { ItemView, WorkspaceLeaf, MarkdownRenderer, Component } from 'obsidian';
import { Message, ConnectionStatus } from '../types/acp';
import { ChatInterface } from '../interfaces/chat-interface';
import { ACPClientImpl } from '../core/acp-client-impl';
import { SessionManagerImpl } from '../core/session-manager';

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

    // Check if the connection is properly initialized
    if (!this.acpClient.isConnectionInitialized()) {
      throw new Error('Agent connection not initialized. Please ensure the agent supports ACP protocol.');
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
    }

    return this.currentSessionId;
  }

  private getConnectedJsonRpcClient(): any {
    if (!this.acpClient) {
      return null;
    }

    // Get the first available connection
    const connection = (this.acpClient as any).getFirstAvailableConnection();
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
  }

  private createChatInterface(container: Element): void {
    // Create main chat layout
    const chatWrapper = container.createDiv('acp-chat-wrapper');

    // Simple header with connection status
    const headerSection = chatWrapper.createDiv('acp-header-section');
    
    // Connection status bar
    this.statusIndicator = headerSection.createDiv('acp-status-bar');
    this.updateStatusDisplay();

    // Messages container with scrolling
    this.messagesContainer = chatWrapper.createDiv('acp-messages-container');
    this.messagesContainer.addClass('acp-scrollable');

    // Clean input container
    this.inputContainer = chatWrapper.createDiv('acp-input-container');
    
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

    // Enhanced send button with dropdown
    const sendButtonContainer = inputRow.createDiv('acp-send-container');
    
    this.sendButton = sendButtonContainer.createEl('button', {
      cls: 'acp-send-button',
      text: '→'
    });

    // Quick access dropdown
    const quickAccessButton = sendButtonContainer.createEl('button', {
      cls: 'acp-quick-access-button',
      text: '⚡'
    });

    this.createQuickAccessDropdown(sendButtonContainer, quickAccessButton);

    // Initially disable input if not connected
    this.updateInputState();
  }

  private setupEventListeners(): void {
    // Send button click
    this.sendButton.addEventListener('click', () => {
      this.handleSendMessage();
    });

    // Enter key to send (Shift+Enter for new line)
    this.inputField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.handleSendMessage();
      }
    });

    // Auto-resize textarea
    this.inputField.addEventListener('input', () => {
      this.autoResizeTextarea();
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

    // Create user message
    const userMessage: Message = {
      role: 'user',
      content: [{ type: 'text', text }]
    };

    // Display user message
    this.displayMessage(userMessage);

    // Send message via ACP protocol
    try {
      if (!this.sessionManager) {
        throw new Error('Session manager not initialized');
      }

      const sessionId = await this.ensureSession();
      console.log({userMessage});
      const result = await this.sessionManager.sendPrompt(sessionId, [userMessage]);
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
    if (!chunk || chunk.type !== 'text' || !chunk.text) {
      return;
    }

    // Find or create a streaming message container
    let streamingContainer = this.messagesContainer?.querySelector('.streaming-message') as HTMLElement;
    
    if (!streamingContainer) {
      // Create new streaming message container
      streamingContainer = document.createElement('div');
      streamingContainer.className = 'message assistant-message streaming-message';
      
      const messageContent = document.createElement('div');
      messageContent.className = 'message-content';
      streamingContainer.appendChild(messageContent);
      
      this.messagesContainer?.appendChild(streamingContainer);
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
    this.updateStatusDisplay();
    this.updateInputState();
    
    // Reset session if connection status changed
    if (!status.connected && this.currentSessionId) {
      this.currentSessionId = null;
    }
  }

  private updateStatusDisplay(): void {
    if (!this.statusIndicator) return;

    this.statusIndicator.empty();
    
    const statusIcon = this.statusIndicator.createSpan('acp-status-icon');
    const statusText = this.statusIndicator.createSpan('acp-status-text');

    if (this.connectionStatus.connected) {
      statusIcon.addClass('acp-status-connected');
      statusIcon.textContent = '●';
      statusText.textContent = `Connected to Kiro`;
    } else {
      statusIcon.addClass('acp-status-disconnected');
      statusIcon.textContent = '●';
      statusText.textContent = this.connectionStatus.error ? 
        `Disconnected: ${this.connectionStatus.error}` : 
        'Disconnected';
    }
  }

  private updateInputState(): void {
    if (!this.inputField || !this.sendButton) return;

    const isDisabled = !this.connectionStatus.connected;
    this.inputField.disabled = isDisabled;
    this.sendButton.disabled = isDisabled;

    if (isDisabled) {
      this.inputField.placeholder = 'Connect to an AI assistant to start chatting...';
    } else {
      this.inputField.placeholder = 'Type your message here...';
    }
  }

  private createQuickAccessDropdown(container: HTMLElement, button: HTMLElement): void {
    const dropdown = container.createDiv('acp-dropdown');
    dropdown.style.display = 'none';

    const actions = [
      { icon: '�', text: 'Explain code', command: '/explain' },
      { icon: '🔧', text: 'Fix errors', command: '/fix' },
      { icon: '🧪', text: 'Add tests', command: '/test' },
      { icon: '⚡', text: 'Optimize', command: '/optimize' },
      { icon: '📚', text: 'Document', command: '/document' },
      { icon: '🔄', text: 'Refactor', command: '/refactor' },
      { icon: '📁', text: 'File operations', prompt: 'What file operations can you help me with?' },
      { icon: '🔍', text: 'Search code', prompt: 'How can you help me search through my codebase?' },
      { icon: '🌐', text: 'Web search', prompt: 'How can you help with web search and research?' }
    ];

    actions.forEach(action => {
      const item = dropdown.createDiv('acp-dropdown-item');
      
      const text = item.createSpan('acp-dropdown-text');
      text.textContent = action.text;

      item.addEventListener('click', () => {
        if (action.command) {
          this.inputField.value = action.command;
          this.handleSlashCommand(action.command);
        } else if (action.prompt) {
          this.inputField.value = action.prompt;
          this.autoResizeTextarea();
          this.inputField.focus();
        }
        dropdown.style.display = 'none';
      });
    });

    let isOpen = false;
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      isOpen = !isOpen;
      dropdown.style.display = isOpen ? 'block' : 'none';
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      if (isOpen) {
        dropdown.style.display = 'none';
        isOpen = false;
      }
    });
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
}