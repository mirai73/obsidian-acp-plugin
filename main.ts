import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';
import { logger, LogLevel } from './src/core/logging-system';
import { PluginSettings, DEFAULT_SETTINGS } from './src/types/plugin';
import {
  ConnectionStatus,
  SessionRequestPermissionParams,
  SessionRequestPermissionResult,
} from './src/types/acp';
import { ChatView, CHAT_VIEW_TYPE } from './src/ui/chat-view';
import { ACPClientImpl } from './src/core/acp-client-impl';
import { ObsidianFileOperationsHandler } from './src/core/obsidian-file-operations';
import { PermissionManagerImpl } from './src/core/permission-manager';
import { ACPSessionHandlers } from './src/core/acp-method-handlers';
import {
  ACPChatSettingTab,
  ConnectionStatusModal,
  ChangeHistoryModal,
} from './src/ui/settings-tab';
import { SessionPersistenceService } from './src/core/session-persistence';

export default class ACPChatPlugin extends Plugin {
  settings: PluginSettings;
  acpClient: ACPClientImpl;
  sessionPersistence: SessionPersistenceService;
  private chatView: ChatView | null = null;
  private statusBarItem: HTMLElement | null = null;
  fileOperationsHandler: ObsidianFileOperationsHandler;

  async onload() {
    await this.loadSettings();

    // Initialise session persistence service
    this.sessionPersistence = new SessionPersistenceService(this);

    // Run auto-cleanup of old sessions on startup
    this.sessionPersistence.runAutoCleanup().then((removed) => {
      if (removed > 0) {
        console.log(`ACP: cleaned up ${removed} expired session(s)`);
      }
    });

    if (
      process.env.OBSIDIAN_ACP_DEBUG === 'true' ||
      process.env.OBSIDIAN_ACP_DEBUG === '1'
    ) {
      logger.configure({
        level: LogLevel.DEBUG,
        enableConsoleOutput: true,
      });
      console.log('ACP Plugin: Debug logging enabled via environment variable');
    }
    // Initialize Obsidian-integrated file operations handler
    this.fileOperationsHandler = new ObsidianFileOperationsHandler({
      app: this.app,
      enableUndoRedo: true,
      trackChanges: true,
      showNotifications:
        this.settings.ui?.showFileOperationNotifications ?? false,
    });

    // Initialize ACP client with reasonable timeout
    this.acpClient = new ACPClientImpl({
      requestTimeout:
        (this.settings.connection?.connectionTimeout ?? 10) * 1000, // Convert seconds to ms
      connectionTimeout:
        (this.settings.connection?.connectionTimeout ?? 10) * 1000,
      enableConnectionRecovery: this.settings.connection?.autoReconnect ?? true,
      recoveryConfig: {
        maxRetries: this.settings.connection?.maxReconnectAttempts ?? 3,
        initialDelay:
          (this.settings.connection?.reconnectInterval ?? 30) * 1000,
        maxDelay: (this.settings.connection?.reconnectInterval ?? 30) * 1000,
      },
    });

    // Set up file operations handlers using the Obsidian-integrated handler
    this.acpClient.setFsReadTextFileHandler(async (params) => {
      return await this.fileOperationsHandler.readTextFile(params.path);
    });

    this.acpClient.setFsWriteTextFileHandler(async (params) => {
      await this.fileOperationsHandler.writeTextFile(
        params.path,
        params.content
      );
    });

    // Set up ACP client event listeners to update chat view connection status
    this.acpClient.on('agent-connected', (agentId: string) => {
      new Notice(`Connected ${agentId}`, 5000);

      this.updateChatConnectionStatus();
    });

    this.acpClient.on('agent-disconnected', (agentId: string) => {
      new Notice(`Disconnected from ${agentId}`, 5000);

      this.updateChatConnectionStatus();
    });

    // Set up permission handler
    const permissionManager = new PermissionManagerImpl(
      {
        allowedPaths: this.settings.permissions?.allowedPaths || [],
        readOnlyPaths: this.settings.permissions?.readOnlyPaths || [],
        deniedPaths: this.settings.permissions?.deniedPaths || [],
        requireConfirmation:
          this.settings.permissions?.requireConfirmation ?? true,
        logOperations: this.settings.permissions?.logOperations ?? true,
      },
      async (params) => {
        return await this.userConfirmationHandler(params);
      }
    );

    const acpSessionHandlers = new ACPSessionHandlers(permissionManager);

    this.acpClient.setSessionRequestPermissionHandler(async (params) => {
      return await acpSessionHandlers.handleSessionRequestPermission(params);
    });

    // Register chat view
    try {
      this.registerView(CHAT_VIEW_TYPE, (leaf) => {
        this.chatView = new ChatView(leaf);
        // Connect the chat view to the ACP client
        this.chatView.setACPClient(this.acpClient, this.sessionPersistence);
        return this.chatView;
      });
    } catch (e) {
      console.warn('ACP View registration skip (already registered):', e);
    }

    // This creates an icon in the left ribbon.
    const ribbonIconEl = this.addRibbonIcon(
      'message-circle',
      'ACP Chat',
      (evt: MouseEvent) => {
        this.openChatView();
      }
    );
    ribbonIconEl.addClass('acp-chat-ribbon-class');

    // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.setText('ACP: Disconnected');

    // Add comprehensive command palette integration
    this.addCommand({
      id: 'open-acp-chat',
      name: 'Open ACP Chat',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'a' }],
      callback: () => {
        this.openChatView();
      },
    });

    this.addCommand({
      id: 'toggle-acp-chat',
      name: 'Toggle ACP Chat Panel',
      hotkeys: [{ modifiers: ['Mod', 'Alt'], key: 'a' }],
      callback: () => {
        this.toggleChatView();
      },
    });

    this.addCommand({
      id: 'focus-acp-chat-input',
      name: 'Focus ACP Chat Input',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'i' }],
      callback: () => {
        this.focusChatInput();
      },
    });

    this.addCommand({
      id: 'clear-acp-chat',
      name: 'Clear ACP Chat History',
      callback: () => {
        this.clearChatHistory();
      },
    });

    this.addCommand({
      id: 'connect-all-agents',
      name: 'Connect All ACP Agents',
      callback: async () => {
        await this.connectAllAgents();
      },
    });

    this.addCommand({
      id: 'disconnect-all-agents',
      name: 'Disconnect All ACP Agents',
      callback: async () => {
        await this.disconnectAllAgents();
      },
    });

    this.addCommand({
      id: 'show-acp-connection-status',
      name: 'Show ACP Connection Status',
      callback: () => {
        this.showConnectionStatus();
      },
    });

    this.addCommand({
      id: 'undo-acp-file-operation',
      name: 'Undo Last ACP File Operation',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'z' }],
      callback: async () => {
        await this.undoLastFileOperation();
      },
    });

    this.addCommand({
      id: 'show-acp-change-history',
      name: 'Show ACP File Change History',
      callback: () => {
        this.showChangeHistory();
      },
    });

    this.addCommand({
      id: 'clear-acp-change-history',
      name: 'Clear ACP File Change History',
      callback: () => {
        this.clearChangeHistory();
      },
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new ACPChatSettingTab(this.app, this));

    // Initialize connection status display
    this.updateChatConnectionStatus();

    // Automatically connect to all enabled agents
    this.app.workspace.onLayoutReady(async () => {
      await this.connectAllAgents();
      this.updateChatConnectionStatus();
    });
  }

  onunload() {
    // Cleanup ACP client (shutdown is async but we fire-and-forget on unload)
    if (this.acpClient) {
      this.acpClient.shutdown();
    }
  }

  async openChatView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);

    if (leaves.length > 0) {
      // Chat view already exists, focus it
      leaf = leaves[0];
    } else {
      // Create new chat view in right sidebar
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
      // Store reference to chat view
      this.chatView = leaf.view as ChatView;
      // Ensure the chat view has the ACP client
      if (this.chatView && this.acpClient) {
        this.chatView.setACPClient(this.acpClient, this.sessionPersistence);
        this.chatView.refreshConnection();
      }
      // Update connection status when view is opened
      this.updateChatConnectionStatus();
      // Focus the input field
      if (this.chatView) {
        setTimeout(() => this.chatView!.focusInput(), 100);
      }
    }
  }

  async toggleChatView(): Promise<void> {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);

    if (leaves.length > 0) {
      // Chat view exists, check if it's active
      const leaf = leaves[0];
      const isActive = workspace.getActiveViewOfType(ChatView) !== null;

      if (isActive) {
        // Close the chat view
        leaf.detach();
      } else {
        // Focus the existing chat view
        workspace.revealLeaf(leaf);
      }
    } else {
      // Open new chat view
      await this.openChatView();
    }
  }

  async focusChatInput(): Promise<void> {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);

    if (leaves.length > 0) {
      const leaf = leaves[0];
      workspace.revealLeaf(leaf);

      const view = leaf.view as ChatView;
      if (view && view.focusInput) {
        setTimeout(() => view.focusInput(), 100);
      }
    } else {
      // Open chat view and focus input
      await this.openChatView();
    }
  }

  clearChatHistory(): void {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);

    if (leaves.length > 0) {
      const view = leaves[0].view as ChatView;
      if (view && view.clearMessages) {
        view.clearMessages();
        // Show confirmation
        new Notice('Chat history cleared');
      }
    } else {
      new Notice('No active chat view found');
    }
  }

  async connectAllAgents(): Promise<void> {
    const enabledAgents = this.settings.agents.filter((agent) => agent.enabled);

    if (enabledAgents.length === 0) {
      new Notice('No enabled agents found');
      return;
    }

    for (const agent of enabledAgents) {
      try {
        this.acpClient?.startAgentWithConfig(agent);
      } catch (error) {
        console.error(`Failed to connect agent ${agent.name}:`, error);
      }
    }
  }

  async disconnectAllAgents(): Promise<void> {
    const connectedAgents = this.acpClient?.getConnectedAgents() || [];

    if (connectedAgents.length === 0) {
      new Notice('No connected agents found');
      return;
    }

    let disconnected = 0;
    let failed = 0;

    for (const agentId of connectedAgents) {
      try {
        await this.acpClient?.stopAgentById(agentId);
        disconnected++;
      } catch (error) {
        console.error(`Failed to disconnect agent ${agentId}:`, error);
        failed++;
      }
    }

    if (disconnected > 0) {
      new Notice(
        `Disconnected ${disconnected} agent${disconnected > 1 ? 's' : ''}`
      );
    }
    if (failed > 0) {
      new Notice(
        `Failed to disconnect ${failed} agent${failed > 1 ? 's' : ''}`,
        5000
      );
    }
  }

  showConnectionStatus(): void {
    const statusMap = this.acpClient?.getAllConnectionStatuses() || new Map();
    const agents = this.settings.agents;

    if (agents.length === 0) {
      new Notice('No agents configured');
      return;
    }

    const statusLines: string[] = [];
    agents.forEach((agent) => {
      const status = statusMap.get(agent.id);
      const statusText = status?.connected ? '✅ Connected' : '❌ Disconnected';
      statusLines.push(`${agent.name}: ${statusText}`);
    });

    // Create a modal to show status
    const modal = new ConnectionStatusModal(this.app, statusLines);
    modal.open();
  }

  async undoLastFileOperation(): Promise<void> {
    if (!this.fileOperationsHandler) {
      new Notice('File operations handler not initialized');
      return;
    }

    const success = await this.fileOperationsHandler.undoLastOperation();
    if (success) {
      new Notice('Undid last ACP file operation');
    } else {
      new Notice('No ACP file operations to undo');
    }
  }

  showChangeHistory(): void {
    if (!this.fileOperationsHandler) {
      new Notice('File operations handler not initialized');
      return;
    }

    const trackedFiles = this.fileOperationsHandler.getTrackedFiles();
    if (trackedFiles.length === 0) {
      new Notice('No ACP file changes tracked');
      return;
    }

    // Create a modal to show change history
    const modal = new ChangeHistoryModal(
      this.app,
      this.fileOperationsHandler,
      trackedFiles
    );
    modal.open();
  }

  clearChangeHistory(): void {
    if (!this.fileOperationsHandler) {
      new Notice('File operations handler not initialized');
      return;
    }

    this.fileOperationsHandler.clearChangeHistory();
    new Notice('Cleared ACP file change history');
  }

  /**
   * Handle permission requests from agents
   */
  async userConfirmationHandler(
    params: SessionRequestPermissionParams
  ): Promise<SessionRequestPermissionResult> {
    try {
      // Ensure chat view is open and revealed
      if (!this.chatView) {
        await this.openChatView();
      }

      if (this.chatView) {
        // Reveal the leaf
        this.app.workspace.revealLeaf(this.chatView.leaf);

        // Show permission in chat timeline
        const selectedOptionId =
          await this.chatView.appendPermissionRequest(params);

        if (selectedOptionId === null) {
          // User cancelled
          return {
            outcome: {
              outcome: 'cancelled',
            },
          };
        }

        return {
          outcome: {
            outcome: 'selected',
            optionId: selectedOptionId,
          },
        };
      }

      // Fallback to auto-reject if no UI available
      return {
        outcome: {
          outcome: 'cancelled',
        },
      };
    } catch (error) {
      console.error('Error handling permission request:', error);
      // Default to rejection on error
      return {
        outcome: {
          outcome: 'cancelled',
        },
      };
    }
  }

  /**
   * Update the chat view's connection status based on current agent connections
   */
  private updateChatConnectionStatus(): void {
    const connectedAgents = this.acpClient?.getConnectedAgents() || [];
    const connectionStatus: ConnectionStatus = {
      connected: connectedAgents.length > 0,
      agentName:
        connectedAgents.length === 1
          ? connectedAgents[0]
          : connectedAgents.length > 1
            ? `${connectedAgents.length} agents`
            : undefined,
    };

    // Update chat view if available
    if (this.chatView) {
      this.chatView.showConnectionStatus(connectionStatus);
      // Also refresh the connection to ensure JSON-RPC client is set
      this.chatView.refreshConnection();
    }

    // Update status bar
    if (this.statusBarItem) {
      if (connectionStatus.connected) {
        const statusText = connectionStatus.agentName
          ? `ACP: Connected (${connectionStatus.agentName})`
          : 'ACP: Connected';
        this.statusBarItem.setText(statusText);
      } else {
        this.statusBarItem.setText('ACP: Disconnected');
      }
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
