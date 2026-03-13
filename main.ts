import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	Modal,
	Notice,
} from "obsidian";

import { PluginSettings, DEFAULT_SETTINGS, AgentConfig } from './src/types/plugin';
import { ConnectionStatus, SessionRequestPermissionParams, SessionRequestPermissionResult } from './src/types/acp';
import { ChatView, CHAT_VIEW_TYPE } from './src/ui/chat-view';
import { ACPClientImpl } from './src/core/acp-client-impl';
import { ObsidianFileOperationsHandler } from './src/core/obsidian-file-operations';
import { ThemeManager, ThemeConfig } from './src/ui/theme-manager';
import { PermissionDialog } from './src/ui/permission-dialog';
import { PermissionManagerImpl } from './src/core/permission-manager';
import { ACPSessionHandlers } from './src/core/acp-method-handlers';

export default class ACPChatPlugin extends Plugin {
	settings: PluginSettings;
	acpClient: ACPClientImpl;
	private chatView: ChatView | null = null;
	private statusBarItem: HTMLElement | null = null;
	fileOperationsHandler: ObsidianFileOperationsHandler;
	themeManager: ThemeManager;

	async onload() {
		await this.loadSettings();

		// Initialize theme manager
		this.themeManager = new ThemeManager(this.app, {
			mode: this.settings.ui?.theme || 'auto',
			respectSystemPreference: true,
			customColors: this.settings.ui?.customColors
		});
		this.addChild(this.themeManager);

		// Load settings styles
		this.addStyle();

		// Initialize Obsidian-integrated file operations handler
		this.fileOperationsHandler = new ObsidianFileOperationsHandler({
			app: this.app,
			enableUndoRedo: true,
			trackChanges: true,
			showNotifications: this.settings.ui?.showFileOperationNotifications ?? false
		});

		// Initialize ACP client with reasonable timeout
		this.acpClient = new ACPClientImpl({ requestTimeout: 30000 });

		// Set up file operations handlers using the Obsidian-integrated handler
		this.acpClient.setFsReadTextFileHandler(async (params) => {
			return await this.fileOperationsHandler.readTextFile(params.path);
		});

		this.acpClient.setFsWriteTextFileHandler(async (params) => {
			await this.fileOperationsHandler.writeTextFile(params.path, params.content);
		});

		// Set up ACP client event listeners to update chat view connection status
		this.acpClient.on('agent-connected', (agentId: string) => {
			this.updateChatConnectionStatus();
		});

		this.acpClient.on('agent-disconnected', (agentId: string) => {
			this.updateChatConnectionStatus();
		});

		// Set up permission handler
		const permissionManager = new PermissionManagerImpl(
			{
				allowedPaths: this.settings.permissions?.allowedPaths || [],
				deniedPaths: this.settings.permissions?.deniedPaths || [],
				requireConfirmation: this.settings.permissions?.showPermissionDialog !== false,
				logOperations: true // Configured to true by default for auditing
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
			this.registerView(
				CHAT_VIEW_TYPE,
				(leaf) => {
					this.chatView = new ChatView(leaf);
					// Connect the chat view to the ACP client
					this.chatView.setACPClient(this.acpClient);
					return this.chatView;
				}
			);
		} catch (e) {
			console.warn("ACP View registration skip (already registered):", e);
		}

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon(
			"message-circle",
			"ACP Chat",
			(evt: MouseEvent) => {
				this.openChatView();
			}
		);
		ribbonIconEl.addClass("acp-chat-ribbon-class");

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.setText("ACP: Disconnected");

		// Add comprehensive command palette integration
		this.addCommand({
			id: "open-acp-chat",
			name: "Open ACP Chat",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "a" }],
			callback: () => {
				this.openChatView();
			},
		});

		this.addCommand({
			id: "toggle-acp-chat",
			name: "Toggle ACP Chat Panel",
			hotkeys: [{ modifiers: ["Mod", "Alt"], key: "a" }],
			callback: () => {
				this.toggleChatView();
			},
		});

		this.addCommand({
			id: "focus-acp-chat-input",
			name: "Focus ACP Chat Input",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "i" }],
			callback: () => {
				this.focusChatInput();
			},
		});

		this.addCommand({
			id: "clear-acp-chat",
			name: "Clear ACP Chat History",
			callback: () => {
				this.clearChatHistory();
			},
		});

		this.addCommand({
			id: "connect-all-agents",
			name: "Connect All ACP Agents",
			callback: async () => {
				await this.connectAllAgents();
			},
		});

		this.addCommand({
			id: "disconnect-all-agents",
			name: "Disconnect All ACP Agents",
			callback: async () => {
				await this.disconnectAllAgents();
			},
		});

		this.addCommand({
			id: "show-acp-connection-status",
			name: "Show ACP Connection Status",
			callback: () => {
				this.showConnectionStatus();
			},
		});

		this.addCommand({
			id: "undo-acp-file-operation",
			name: "Undo Last ACP File Operation",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "z" }],
			callback: async () => {
				await this.undoLastFileOperation();
			},
		});

		this.addCommand({
			id: "show-acp-change-history",
			name: "Show ACP File Change History",
			callback: () => {
				this.showChangeHistory();
			},
		});

		this.addCommand({
			id: "clear-acp-change-history",
			name: "Clear ACP File Change History",
			callback: () => {
				this.clearChangeHistory();
			},
		});

		this.addCommand({
			id: "toggle-acp-theme",
			name: "Toggle ACP Theme (Light/Dark)",
			callback: () => {
				this.toggleTheme();
			},
		});

		this.addCommand({
			id: "refresh-acp-theme",
			name: "Refresh ACP Theme Integration",
			callback: () => {
				this.refreshTheme();
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ACPChatSettingTab(this.app, this));

		// Initialize connection status display
		this.updateChatConnectionStatus();

		// Automatically connect to all enabled agents
		this.app.workspace.onLayoutReady(async () => {
			await this.connectAllAgents();
		});


	}

	onunload() {
		// Cleanup ACP client
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
				this.chatView.setACPClient(this.acpClient);
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
				new Notice("Chat history cleared");
			}
		} else {
			new Notice("No active chat view found");
		}
	}

	async connectAllAgents(): Promise<void> {
		const enabledAgents = this.settings.agents.filter(agent => agent.enabled);
		
		if (enabledAgents.length === 0) {
			new Notice("No enabled agents found");
			return;
		}

		let connected = 0;
		let failed = 0;

		for (const agent of enabledAgents) {
			try {
				await this.acpClient?.startAgentWithConfig(agent);
				connected++;
			} catch (error) {
				console.error(`Failed to connect agent ${agent.name}:`, error);
				failed++;
			}
		}

		if (connected > 0) {
			new Notice(`Connected ${connected} agent${connected > 1 ? 's' : ''}`);
		}
		if (failed > 0) {
			new Notice(`Failed to connect ${failed} agent${failed > 1 ? 's' : ''}`, 5000);
		}
	}

	async disconnectAllAgents(): Promise<void> {
		const connectedAgents = this.acpClient?.getConnectedAgents() || [];
		
		if (connectedAgents.length === 0) {
			new Notice("No connected agents found");
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
			new Notice(`Disconnected ${disconnected} agent${disconnected > 1 ? 's' : ''}`);
		}
		if (failed > 0) {
			new Notice(`Failed to disconnect ${failed} agent${failed > 1 ? 's' : ''}`, 5000);
		}
	}

	showConnectionStatus(): void {
		const statusMap = this.acpClient?.getAllConnectionStatuses() || new Map();
		const agents = this.settings.agents;

		if (agents.length === 0) {
			new Notice("No agents configured");
			return;
		}

		const statusLines: string[] = [];
		agents.forEach(agent => {
			const status = statusMap.get(agent.id);
			const statusText = status?.connected ? "✅ Connected" : "❌ Disconnected";
			statusLines.push(`${agent.name}: ${statusText}`);
		});

		// Create a modal to show status
		const modal = new ConnectionStatusModal(this.app, statusLines);
		modal.open();
	}

	async undoLastFileOperation(): Promise<void> {
		if (!this.fileOperationsHandler) {
			new Notice("File operations handler not initialized");
			return;
		}

		const success = await this.fileOperationsHandler.undoLastOperation();
		if (success) {
			new Notice("Undid last ACP file operation");
		} else {
			new Notice("No ACP file operations to undo");
		}
	}

	showChangeHistory(): void {
		if (!this.fileOperationsHandler) {
			new Notice("File operations handler not initialized");
			return;
		}

		const trackedFiles = this.fileOperationsHandler.getTrackedFiles();
		if (trackedFiles.length === 0) {
			new Notice("No ACP file changes tracked");
			return;
		}

		// Create a modal to show change history
		const modal = new ChangeHistoryModal(this.app, this.fileOperationsHandler, trackedFiles);
		modal.open();
	}

	clearChangeHistory(): void {
		if (!this.fileOperationsHandler) {
			new Notice("File operations handler not initialized");
			return;
		}

		this.fileOperationsHandler.clearChangeHistory();
		new Notice("Cleared ACP file change history");
	}

	toggleTheme(): void {
		if (!this.themeManager) {
			new Notice("Theme manager not initialized");
			return;
		}

		const currentTheme = this.themeManager.getCurrentTheme();
		const newMode = currentTheme === 'dark' ? 'light' : 'dark';
		
		this.themeManager.setThemeMode(newMode);
		this.settings.ui = this.settings.ui || {} as any;
		this.settings.ui.theme = newMode;
		this.saveSettings();
		
		new Notice(`Switched to ${newMode} theme`);
	}

	refreshTheme(): void {
		if (!this.themeManager) {
			new Notice("Theme manager not initialized");
			return;
		}

		// Update theme manager with current settings
		this.themeManager.updateConfig({
			mode: this.settings.ui?.theme || 'auto',
			respectSystemPreference: true,
			customColors: this.settings.ui?.customColors
		});

		new Notice("Refreshed ACP theme integration");
	}

	/**
	 * Handle permission requests from agents
	 */
	async userConfirmationHandler(params: SessionRequestPermissionParams): Promise<SessionRequestPermissionResult> {
		try {
			// Check if permission dialogs are enabled
			if (!this.settings.permissions?.showPermissionDialog) {
				// Auto-approve if dialogs are disabled
				return {
					outcome: {
						outcome: 'selected',
						optionId: 'allow_once'
					}
				};
			}

			// Ensure chat view is open and revealed
			if (!this.chatView) {
				await this.openChatView();
			}

			if (this.chatView) {
				// Reveal the leaf
				this.app.workspace.revealLeaf(this.chatView.leaf);

				// Show permission in chat timeline
				const selectedOptionId = await this.chatView.appendPermissionRequest(params);

				if (selectedOptionId === null) {
					// User cancelled
					return {
						outcome: {
							outcome: 'cancelled'
						}
					};
				}

				return {
					outcome: {
						outcome: 'selected',
						optionId: selectedOptionId
					}
				};
			}

			// Fallback to modal if chat view is somehow unavailable
			const dialog = new PermissionDialog(this.app, {
				sessionId: params.sessionId,
				toolCall: params.toolCall,
				options: params.options
			});

			const selectedId = await dialog.showAndWait();

			if (selectedId === null) {
				return {
					outcome: {
						outcome: 'cancelled'
					}
				};
			}

			return {
				outcome: {
					outcome: 'selected',
					optionId: selectedId
				}
			};

		} catch (error) {
			console.error('Error handling permission request:', error);
			// Default to rejection on error
			return {
				outcome: {
					outcome: 'selected',
					optionId: 'reject_once'
				}
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
			agentName: connectedAgents.length === 1 ? connectedAgents[0] : 
					  connectedAgents.length > 1 ? `${connectedAgents.length} agents` : undefined
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
				const statusText = connectionStatus.agentName ? 
					`ACP: Connected (${connectionStatus.agentName})` : 
					'ACP: Connected';
				this.statusBarItem.setText(statusText);
			} else {
				this.statusBarItem.setText('ACP: Disconnected');
			}
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private addStyle() {
		// Add settings styles
		const settingsStyle = document.createElement('style');
		settingsStyle.textContent = `
			/* ACP Chat Plugin Settings Styles */
			.agent-list-container {
				margin: 1rem 0;
			}
			.agent-item {
				border: 1px solid var(--background-modifier-border);
				border-radius: 6px;
				padding: 1rem;
				margin-bottom: 1rem;
				background: var(--background-secondary);
			}
			.agent-header {
				display: flex;
				justify-content: space-between;
				align-items: center;
				margin-bottom: 0.5rem;
			}
			.agent-header h4 {
				margin: 0;
				color: var(--text-normal);
			}
			.agent-status {
				padding: 0.25rem 0.5rem;
				border-radius: 4px;
				font-size: 0.8rem;
				font-weight: 500;
				text-transform: uppercase;
			}
			.status-connected {
				background: var(--color-green);
				color: white;
			}
			.status-connecting {
				background: var(--color-yellow);
				color: var(--text-on-accent);
			}
			.status-disconnected {
				background: var(--color-red);
				color: white;
			}
			.status-error {
				background: var(--color-red);
				color: white;
			}
			.agent-details {
				margin-bottom: 0.75rem;
				font-size: 0.85rem;
				color: var(--text-muted);
				line-height: 1.4;
			}
			.agent-details div {
				margin-bottom: 0.25rem;
				word-break: break-all;
			}
			.agent-controls {
				display: flex;
				gap: 0.75rem;
				align-items: center;
				flex-wrap: wrap;
				margin-top: 1rem;
				padding-top: 0.75rem;
				border-top: 1px solid var(--background-modifier-border);
			}
			.checkbox-container {
				display: flex;
				align-items: center;
				gap: 0.5rem;
				cursor: pointer;
				font-size: 0.9rem;
				margin-right: 0.5rem;
				user-select: none;
				white-space: nowrap;
			}
			.checkbox-container input[type="checkbox"] {
				margin: 0;
				cursor: pointer;
			}
			.connection-status-container {
				margin: 1rem 0;
				padding: 1rem;
				background: var(--background-secondary);
				border-radius: 6px;
			}
			.connection-status-container h4 {
				margin: 0 0 0.5rem 0;
				color: var(--text-normal);
			}
			.connection-status-list {
				display: flex;
				flex-direction: column;
				gap: 0.5rem;
			}
			.status-item {
				display: flex;
				align-items: center;
				gap: 1rem;
				padding: 0.5rem;
				background: var(--background-primary);
				border-radius: 4px;
			}
			.status-name {
				font-weight: 500;
				min-width: 120px;
			}
			.status-indicator {
				padding: 0.25rem 0.5rem;
				border-radius: 4px;
				font-size: 0.75rem;
				font-weight: 500;
				text-transform: uppercase;
				min-width: 80px;
				text-align: center;
			}
			.status-time {
				font-size: 0.8rem;
				color: var(--text-muted);
				margin-left: auto;
			}
			.modal-button-container {
				display: flex;
				gap: 0.5rem;
				justify-content: flex-end;
				margin-top: 1.5rem;
				padding-top: 1rem;
				border-top: 1px solid var(--background-modifier-border);
			}
			.setting-item {
				margin-bottom: 1rem;
			}
			.setting-item-name {
				font-weight: 500;
				margin-bottom: 0.25rem;
			}
			.setting-item-description {
				font-size: 0.9rem;
				color: var(--text-muted);
				margin-bottom: 0.5rem;
			}
			.setting-item input[type="text"],
			.setting-item textarea {
				width: 100%;
				padding: 0.5rem;
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				background: var(--background-primary);
				color: var(--text-normal);
				font-family: var(--font-interface);
			}
			.setting-item textarea {
				resize: vertical;
				min-height: 80px;
			}
			.permission-test-container {
				display: flex;
				gap: 0.5rem;
				align-items: flex-start;
				margin-bottom: 1rem;
				flex-wrap: wrap;
			}
			.permission-test-input {
				flex: 1;
				min-width: 200px;
			}
			.permission-test-button {
				white-space: nowrap;
			}
			.permission-test-result {
				width: 100%;
				padding: 0.5rem;
				border-radius: 4px;
				margin-top: 0.5rem;
				font-weight: 500;
			}
			.permission-test-result.allowed {
				background: var(--color-green-rgb);
				color: var(--color-green);
				border: 1px solid var(--color-green);
			}
			.permission-test-result.denied {
				background: var(--color-red-rgb);
				color: var(--color-red);
				border: 1px solid var(--color-red);
			}
			.permission-test-result.readonly {
				background: var(--color-yellow-rgb);
				color: var(--color-yellow);
				border: 1px solid var(--color-yellow);
			}
			.permission-test-result.error {
				background: var(--background-modifier-error);
				color: var(--text-error);
				border: 1px solid var(--text-error);
			}
			.permission-presets {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
				gap: 1rem;
				margin-top: 1rem;
			}
			.permission-preset {
				padding: 1rem;
				border: 1px solid var(--background-modifier-border);
				border-radius: 6px;
				background: var(--background-secondary);
			}
			.permission-preset h5 {
				margin: 0 0 0.5rem 0;
				color: var(--text-normal);
			}
			.preset-description {
				font-size: 0.9rem;
				color: var(--text-muted);
				margin-bottom: 1rem;
			}
			.connection-controls {
				margin: 1rem 0;
			}
			.diagnostics-result {
				margin-top: 1rem;
				padding: 1rem;
				background: var(--background-secondary);
				border-radius: 6px;
			}
			.diagnostics-output {
				background: var(--background-primary);
				padding: 1rem;
				border-radius: 4px;
				font-family: var(--font-monospace);
				font-size: 0.9rem;
				white-space: pre-wrap;
				overflow-x: auto;
			}
			.connection-log-container {
				margin-top: 1rem;
			}
			.connection-stats ul {
				list-style: none;
				padding: 0;
				margin: 0;
			}
			.connection-stats li {
				padding: 0.25rem 0;
				border-bottom: 1px solid var(--background-modifier-border);
			}
			.activity-list {
				max-height: 200px;
				overflow-y: auto;
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
			}
			.activity-item {
				display: flex;
				gap: 1rem;
				padding: 0.5rem;
				border-bottom: 1px solid var(--background-modifier-border);
				font-size: 0.9rem;
			}
			.activity-item:last-child {
				border-bottom: none;
			}
			.activity-time {
				color: var(--text-muted);
				min-width: 120px;
			}
			.activity-event {
				font-weight: 500;
				min-width: 100px;
			}
			.activity-details {
				color: var(--text-muted);
				flex: 1;
			}

			/* Permission Dialog Styles */
			.acp-permission-dialog {
				max-width: 500px;
				padding: 20px;
			}

			.acp-permission-dialog h2 {
				margin-bottom: 16px;
				color: var(--text-normal);
				border-bottom: 1px solid var(--background-modifier-border);
				padding-bottom: 8px;
			}

			.permission-details {
				background: var(--background-secondary);
				border-radius: 6px;
				padding: 12px;
				margin-bottom: 16px;
				border-left: 3px solid var(--interactive-accent);
			}

			.permission-details p {
				margin: 4px 0;
				font-size: 14px;
			}

			.permission-tool-title {
				font-weight: 600;
				color: var(--text-normal);
			}

			.permission-operation {
				color: var(--text-muted);
				font-family: var(--font-monospace);
			}

			.permission-resource {
				color: var(--text-muted);
				font-family: var(--font-monospace);
				word-break: break-all;
			}

			.permission-reason {
				color: var(--text-normal);
				font-style: italic;
			}

			.permission-session {
				color: var(--text-faint);
				font-size: 12px;
				font-family: var(--font-monospace);
			}

			.permission-options {
				margin-bottom: 20px;
			}

			.permission-options h3 {
				margin-bottom: 12px;
				color: var(--text-normal);
				font-size: 16px;
			}

			.permission-option {
				display: flex;
				align-items: center;
				padding: 8px 12px;
				margin: 4px 0;
				border-radius: 4px;
				cursor: pointer;
				transition: background-color 0.2s ease;
			}

			.permission-option:hover {
				background: var(--background-modifier-hover);
			}

			.permission-option input[type="radio"] {
				margin-right: 8px;
				cursor: pointer;
			}

			.permission-option label {
				cursor: pointer;
				font-weight: 500;
				color: var(--text-normal);
			}

			.permission-option-description {
				color: var(--text-muted);
				font-size: 12px;
				margin-left: 4px;
			}

			.permission-buttons {
				display: flex;
				gap: 8px;
				justify-content: flex-end;
				margin-top: 20px;
				padding-top: 16px;
				border-top: 1px solid var(--background-modifier-border);
			}

			.permission-buttons button {
				padding: 8px 16px;
				border-radius: 4px;
				border: 1px solid var(--background-modifier-border);
				background: var(--background-primary);
				color: var(--text-normal);
				cursor: pointer;
				transition: all 0.2s ease;
			}

			.permission-buttons button:hover {
				background: var(--background-modifier-hover);
			}

			.permission-buttons button.mod-cta {
				background: var(--interactive-accent);
				color: var(--text-on-accent);
				border-color: var(--interactive-accent);
			}

			.permission-buttons button.mod-cta:hover {
				background: var(--interactive-accent-hover);
			}
		`;
		document.head.appendChild(settingsStyle);
	}
}

class ACPChatSettingTab extends PluginSettingTab {
	plugin: ACPChatPlugin;

	constructor(app: App, plugin: ACPChatPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "ACP Chat Plugin Settings" });

		// Agent Configuration Section
		this.displayAgentConfiguration(containerEl);

		// Permission Configuration Section
		this.displayPermissionConfiguration(containerEl);

		// Connection Management Section
		this.displayConnectionManagement(containerEl);

		// UI Configuration Section
		this.displayUIConfiguration(containerEl);
	}

	private displayAgentConfiguration(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "Agent Configuration" });
		containerEl.createEl("p", { 
			text: "Configure AI assistants that support the Agent Client Protocol (ACP).",
			cls: "setting-item-description"
		});

		// Agent list container
		const agentListContainer = containerEl.createDiv("agent-list-container");
		this.refreshAgentList(agentListContainer);

		// Add new agent button
		new Setting(containerEl)
			.setName("Add New Agent")
			.setDesc("Add a new AI assistant configuration")
			.addButton((button) =>
				button
					.setButtonText("Add Agent")
					.setCta()
					.onClick(() => {
						this.showAddAgentModal();
					})
			);
	}

	private refreshAgentList(container: HTMLElement): void {
		container.empty();

		if (this.plugin.settings.agents.length === 0) {
			container.createEl("p", { 
				text: "No agents configured. Add an agent to get started.",
				cls: "setting-item-description"
			});
			return;
		}

		this.plugin.settings.agents.forEach((agent, index) => {
			const connectionStatus = this.plugin.acpClient?.getConnectionStatus(agent.id);
			const isConnected = connectionStatus?.connected;
			
			const descFragment = document.createDocumentFragment();
			
			if (agent.workingDirectory) {
				descFragment.appendChild(document.createElement("br"));
				descFragment.appendText(`Working Directory: ${agent.workingDirectory}`);
			}
			descFragment.appendChild(document.createElement("br"));
			
			const statusSpan = document.createElement("span");
			statusSpan.style.fontWeight = "bold";
			statusSpan.style.color = isConnected ? "var(--color-green)" : "var(--text-muted)";
			statusSpan.textContent = isConnected ? "CONNECTED" : "DISCONNECTED";
			descFragment.appendChild(statusSpan);

			const setting = new Setting(container)
				.setName(agent.name)
				.setDesc(descFragment);
				
			// Align items to top so buttons are on the same row as the name
			setting.settingEl.style.alignItems = "flex-start";

			// Enable/Disable toggle
			setting.addToggle(toggle => {
				toggle.setValue(agent.enabled)
					.setTooltip(agent.enabled ? "Disable Agent" : "Enable Agent")
					.onChange(async (value) => {
						agent.enabled = value;
						await this.plugin.saveSettings();
						// Refresh to reflect changes
						this.refreshAgentList(container);
					});
			});

			// Connect/Disconnect button
			setting.addButton(button => {
				button.setButtonText(isConnected ? "Disconnect" : "Connect")
					.setTooltip(isConnected ? "Disconnect from agent" : "Connect to agent")
					.onClick(async () => {
						button.setDisabled(true);
						try {
							if (isConnected) {
								await this.plugin.acpClient?.stopAgentById(agent.id);
							} else {
								await this.plugin.acpClient?.startAgentWithConfig(agent);
							}
						} catch(e) {
							console.error(e);
						} finally {
							this.refreshAgentList(container);
						}
					});
				
				if (!isConnected) {
					button.setCta();
				}
			});

			// Edit button
			setting.addButton(button => {
				button.setIcon("pencil")
					.setTooltip("Edit Agent Configuration")
					.onClick(() => {
						this.showEditAgentModal(agent, index);
					});
			});

			// Delete button
			setting.addButton(button => {
				button.setIcon("trash")
					.setTooltip("Delete Agent")
					.setClass("mod-warning")
					.onClick(async () => {
						if (confirm(`Are you sure you want to delete agent "${agent.name}"?`)) {
							this.plugin.settings.agents.splice(index, 1);
							await this.plugin.saveSettings();
							this.refreshAgentList(container);
						}
					});
			});
		});
	}

	private displayPermissionConfiguration(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "Permission Configuration" });
		containerEl.createEl("p", { 
			text: "Control file access permissions for AI assistants.",
			cls: "setting-item-description"
		});

		new Setting(containerEl)
			.setName("Require Permission Confirmation")
			.setDesc("Require user confirmation for file operations")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.permissions?.requireConfirmation ?? true)
					.onChange(async (value) => {
						if (!this.plugin.settings.permissions) {
							this.plugin.settings.permissions = DEFAULT_SETTINGS.permissions!;
						}
						this.plugin.settings.permissions.requireConfirmation = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show Permission Dialog")
			.setDesc("Show detailed permission dialog with operation details")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.permissions?.showPermissionDialog ?? true)
					.onChange(async (value) => {
						if (!this.plugin.settings.permissions) {
							this.plugin.settings.permissions = DEFAULT_SETTINGS.permissions!;
						}
						this.plugin.settings.permissions.showPermissionDialog = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Log Operations")
			.setDesc("Log all file operations performed by AI assistants")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.permissions?.logOperations ?? true)
					.onChange(async (value) => {
						if (!this.plugin.settings.permissions) {
							this.plugin.settings.permissions = DEFAULT_SETTINGS.permissions!;
						}
						this.plugin.settings.permissions.logOperations = value;
						await this.plugin.saveSettings();
					})
			);

		// Permission paths configuration
		containerEl.createEl("h4", { text: "Path-based Permissions" });
		containerEl.createEl("p", { 
			text: "Configure file access permissions using path patterns. Supports wildcards (*) and folder paths.",
			cls: "setting-item-description"
		});

		// Allowed paths configuration
		new Setting(containerEl)
			.setName("Allowed Paths")
			.setDesc("Paths that AI assistants can access (leave empty to allow all vault files)")
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.permissions?.allowedPaths?.join("\n") || "");
				text.setPlaceholder("Enter one path per line\nExample:\nfolder/\n*.md\nspecific-file.txt");
				text.onChange(async (value) => {
					if (!this.plugin.settings.permissions) {
						this.plugin.settings.permissions = DEFAULT_SETTINGS.permissions!;
					}
					this.plugin.settings.permissions.allowedPaths = value
						.split("\n")
						.map(path => path.trim())
						.filter(path => path.length > 0);
					await this.plugin.saveSettings();
				});
			});

		// Read-only paths configuration
		new Setting(containerEl)
			.setName("Read-Only Paths")
			.setDesc("Paths that AI assistants can read but not modify")
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.permissions?.readOnlyPaths?.join("\n") || "");
				text.setPlaceholder("Enter one path per line\nExample:\ntemplates/\nreference/\n*.template");
				text.onChange(async (value) => {
					if (!this.plugin.settings.permissions) {
						this.plugin.settings.permissions = DEFAULT_SETTINGS.permissions!;
					}
					this.plugin.settings.permissions.readOnlyPaths = value
						.split("\n")
						.map(path => path.trim())
						.filter(path => path.length > 0);
					await this.plugin.saveSettings();
				});
			});

		// Denied paths configuration
		new Setting(containerEl)
			.setName("Denied Paths")
			.setDesc("Paths that AI assistants cannot access at all")
			.addTextArea((text) => {
				text.setValue(this.plugin.settings.permissions?.deniedPaths?.join("\n") || "");
				text.setPlaceholder("Enter one path per line\nExample:\nprivate/\nsecrets.md\n*.key");
				text.onChange(async (value) => {
					if (!this.plugin.settings.permissions) {
						this.plugin.settings.permissions = DEFAULT_SETTINGS.permissions!;
					}
					this.plugin.settings.permissions.deniedPaths = value
						.split("\n")
						.map(path => path.trim())
						.filter(path => path.length > 0);
					await this.plugin.saveSettings();
				});
			});

		// Permission testing section
		containerEl.createEl("h4", { text: "Permission Testing" });
		const testContainer = containerEl.createDiv("permission-test-container");
		
		const testInput = testContainer.createEl("input", { 
			type: "text", 
			placeholder: "Enter a file path to test permissions...",
			cls: "permission-test-input"
		});
		
		const testButton = testContainer.createEl("button", { 
			text: "Test Path",
			cls: "mod-cta permission-test-button"
		});
		
		const testResult = testContainer.createDiv("permission-test-result");

		testButton.addEventListener("click", () => {
			const path = testInput.value.trim();
			if (!path) {
				testResult.setText("Please enter a path to test");
				testResult.className = "permission-test-result error";
				return;
			}

			const result = this.testPathPermissions(path);
			testResult.setText(result.message);
			testResult.className = `permission-test-result ${result.type}`;
		});

		testInput.addEventListener("keypress", (e) => {
			if (e.key === "Enter") {
				testButton.click();
			}
		});

		// Permission presets
		containerEl.createEl("h4", { text: "Permission Presets" });
		const presetContainer = containerEl.createDiv("permission-presets");
		
		const presets = [
			{
				name: "Restrictive",
				description: "Only allow access to specific folders",
				config: {
					allowedPaths: ["notes/", "drafts/"],
					readOnlyPaths: ["templates/", "reference/"],
					deniedPaths: ["private/", "*.key", "*.secret"]
				}
			},
			{
				name: "Moderate",
				description: "Allow most access with some restrictions",
				config: {
					allowedPaths: [],
					readOnlyPaths: ["templates/"],
					deniedPaths: ["private/", "*.key", "*.secret", ".obsidian/"]
				}
			},
			{
				name: "Permissive",
				description: "Allow access to all files except sensitive ones",
				config: {
					allowedPaths: [],
					readOnlyPaths: [],
					deniedPaths: ["*.key", "*.secret"]
				}
			}
		];

		presets.forEach(preset => {
			const presetItem = presetContainer.createDiv("permission-preset");
			presetItem.createEl("h5", { text: preset.name });
			presetItem.createEl("p", { text: preset.description, cls: "preset-description" });
			
			const applyButton = presetItem.createEl("button", { text: "Apply Preset" });
			applyButton.addEventListener("click", async () => {
				if (!this.plugin.settings.permissions) {
					this.plugin.settings.permissions = DEFAULT_SETTINGS.permissions!;
				}
				
				this.plugin.settings.permissions.allowedPaths = preset.config.allowedPaths;
				this.plugin.settings.permissions.readOnlyPaths = preset.config.readOnlyPaths;
				this.plugin.settings.permissions.deniedPaths = preset.config.deniedPaths;
				
				await this.plugin.saveSettings();
				this.display(); // Refresh the settings display
			});
		});
	}

	private displayConnectionManagement(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "Connection Management" });
		containerEl.createEl("p", { 
			text: "Configure connection behavior and reconnection settings.",
			cls: "setting-item-description"
		});

		new Setting(containerEl)
			.setName("Auto Reconnect")
			.setDesc("Automatically attempt to reconnect when connection is lost")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.connection?.autoReconnect ?? true)
					.onChange(async (value) => {
						if (!this.plugin.settings.connection) {
							this.plugin.settings.connection = DEFAULT_SETTINGS.connection!;
						}
						this.plugin.settings.connection.autoReconnect = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Reconnect Interval")
			.setDesc("Time between reconnection attempts (seconds)")
			.addSlider((slider) =>
				slider
					.setLimits(5, 300, 5)
					.setValue(this.plugin.settings.connection?.reconnectInterval ?? 30)
					.setDynamicTooltip()
					.onChange(async (value) => {
						if (!this.plugin.settings.connection) {
							this.plugin.settings.connection = DEFAULT_SETTINGS.connection!;
						}
						this.plugin.settings.connection.reconnectInterval = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Max Reconnect Attempts")
			.setDesc("Maximum number of reconnection attempts before giving up")
			.addSlider((slider) =>
				slider
					.setLimits(1, 10, 1)
					.setValue(this.plugin.settings.connection?.maxReconnectAttempts ?? 3)
					.setDynamicTooltip()
					.onChange(async (value) => {
						if (!this.plugin.settings.connection) {
							this.plugin.settings.connection = DEFAULT_SETTINGS.connection!;
						}
						this.plugin.settings.connection.maxReconnectAttempts = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Connection Timeout")
			.setDesc("Timeout for initial connection attempts (seconds)")
			.addSlider((slider) =>
				slider
					.setLimits(5, 60, 5)
					.setValue(this.plugin.settings.connection?.connectionTimeout ?? 10)
					.setDynamicTooltip()
					.onChange(async (value) => {
						if (!this.plugin.settings.connection) {
							this.plugin.settings.connection = DEFAULT_SETTINGS.connection!;
						}
						this.plugin.settings.connection.connectionTimeout = value;
						await this.plugin.saveSettings();
					})
			);

		// Connection status display
		const statusContainer = containerEl.createDiv("connection-status-container");
		statusContainer.createEl("h4", { text: "Connection Status" });
		
		const statusList = statusContainer.createDiv("connection-status-list");
		this.refreshConnectionStatus(statusList);

		// Connection controls
		const controlsContainer = containerEl.createDiv("connection-controls");
		
		new Setting(controlsContainer)
			.setName("Connect All Enabled Agents")
			.setDesc("Start connections to all enabled agents")
			.addButton((button) =>
				button
					.setButtonText("Connect All")
					.setCta()
					.onClick(async () => {
						await this.connectAllAgents();
						this.refreshConnectionStatus(statusList);
					})
			);

		new Setting(controlsContainer)
			.setName("Disconnect All Agents")
			.setDesc("Stop all active agent connections")
			.addButton((button) =>
				button
					.setButtonText("Disconnect All")
					.setWarning()
					.onClick(async () => {
						await this.disconnectAllAgents();
						this.refreshConnectionStatus(statusList);
					})
			);

		new Setting(controlsContainer)
			.setName("Refresh Status")
			.setDesc("Refresh connection status for all agents")
			.addButton((button) =>
				button
					.setButtonText("Refresh")
					.onClick(() => {
						this.refreshConnectionStatus(statusList);
					})
			);

		// Connection diagnostics
		containerEl.createEl("h4", { text: "Connection Diagnostics" });
		const diagnosticsContainer = containerEl.createDiv("connection-diagnostics");
		
		new Setting(diagnosticsContainer)
			.setName("Run Connection Test")
			.setDesc("Test connectivity and configuration for all agents")
			.addButton((button) =>
				button
					.setButtonText("Run Test")
					.onClick(() => {
						this.runConnectionDiagnostics(diagnosticsContainer);
					})
			);

		// Connection logs
		containerEl.createEl("h4", { text: "Connection Logs" });
		const logsContainer = containerEl.createDiv("connection-logs");
		this.displayConnectionLogs(logsContainer);
	}

	private displayUIConfiguration(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "UI Configuration" });

		new Setting(containerEl)
			.setName("Show Timestamps")
			.setDesc("Show timestamps in chat messages")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ui?.showTimestamps ?? true)
					.onChange(async (value) => {
						if (!this.plugin.settings.ui) {
							this.plugin.settings.ui = DEFAULT_SETTINGS.ui!;
						}
						this.plugin.settings.ui.showTimestamps = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Enable Markdown")
			.setDesc("Enable markdown rendering in assistant responses")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ui?.enableMarkdown ?? true)
					.onChange(async (value) => {
						if (!this.plugin.settings.ui) {
							this.plugin.settings.ui = DEFAULT_SETTINGS.ui!;
						}
						this.plugin.settings.ui.enableMarkdown = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show File Operation Notifications")
			.setDesc("Show notifications when AI assistants modify files")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ui?.showFileOperationNotifications ?? false)
					.onChange(async (value) => {
						if (!this.plugin.settings.ui) {
							this.plugin.settings.ui = DEFAULT_SETTINGS.ui!;
						}
						this.plugin.settings.ui.showFileOperationNotifications = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Font Size")
			.setDesc("Font size for chat messages")
			.addSlider((slider) =>
				slider
					.setLimits(10, 24, 1)
					.setValue(this.plugin.settings.ui?.fontSize ?? 14)
					.setDynamicTooltip()
					.onChange(async (value) => {
						if (!this.plugin.settings.ui) {
							this.plugin.settings.ui = DEFAULT_SETTINGS.ui!;
						}
						this.plugin.settings.ui.fontSize = value;
						await this.plugin.saveSettings();
					})
			);

		// Enhanced Theme Configuration
		containerEl.createEl("h4", { text: "Theme Integration" });
		containerEl.createEl("p", { 
			text: "Configure how the ACP Chat interface integrates with Obsidian's theme system.",
			cls: "setting-item-description"
		});

		new Setting(containerEl)
			.setName("Theme Mode")
			.setDesc("Choose how the chat interface follows Obsidian's theme")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("auto", "Auto (Follow Obsidian)")
					.addOption("light", "Always Light")
					.addOption("dark", "Always Dark")
					.setValue(this.plugin.settings.ui?.theme ?? "auto")
					.onChange(async (value: "light" | "dark" | "auto") => {
						if (!this.plugin.settings.ui) {
							this.plugin.settings.ui = DEFAULT_SETTINGS.ui!;
						}
						this.plugin.settings.ui.theme = value;
						await this.plugin.saveSettings();
						
						// Update theme manager
						if (this.plugin.themeManager) {
							this.plugin.themeManager.setThemeMode(value);
						}
					})
			);

		new Setting(containerEl)
			.setName("Respect System Theme")
			.setDesc("Follow system dark/light mode preference when theme is set to Auto")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ui?.respectSystemTheme ?? true)
					.onChange(async (value) => {
						if (!this.plugin.settings.ui) {
							this.plugin.settings.ui = DEFAULT_SETTINGS.ui!;
						}
						this.plugin.settings.ui.respectSystemTheme = value;
						await this.plugin.saveSettings();
						
						// Update theme manager
						if (this.plugin.themeManager) {
							this.plugin.themeManager.updateConfig({
								respectSystemPreference: value
							});
						}
					})
			);

		// Theme Status Display
		const themeStatusContainer = containerEl.createDiv("theme-status-container");
		themeStatusContainer.style.padding = "1rem";
		themeStatusContainer.style.background = "var(--background-secondary)";
		themeStatusContainer.style.borderRadius = "6px";
		themeStatusContainer.style.margin = "1rem 0";

		const currentTheme = this.plugin.themeManager?.getCurrentTheme() || 'unknown';
		const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		
		themeStatusContainer.createEl("h5", { text: "Theme Status" });
		themeStatusContainer.createEl("p", { text: `Current Theme: ${currentTheme}` });
		themeStatusContainer.createEl("p", { text: `System Preference: ${systemTheme}` });
		themeStatusContainer.createEl("p", { text: `Obsidian Theme: ${document.body.classList.contains('theme-dark') ? 'dark' : 'light'}` });

		// Theme Actions
		new Setting(containerEl)
			.setName("Theme Actions")
			.setDesc("Quick actions for theme management")
			.addButton((button) =>
				button
					.setButtonText("Toggle Theme")
					.onClick(() => {
						this.plugin.toggleTheme();
						this.display(); // Refresh settings display
					})
			)
			.addButton((button) =>
				button
					.setButtonText("Refresh Theme")
					.onClick(() => {
						this.plugin.refreshTheme();
						this.display(); // Refresh settings display
					})
			);
	}

	private refreshConnectionStatus(container: HTMLElement): void {
		container.empty();

		if (this.plugin.settings.agents.length === 0) {
			container.createEl("p", { 
				text: "No agents configured.",
				cls: "setting-item-description"
			});
			return;
		}

		const statusMap = this.plugin.acpClient?.getAllConnectionStatuses() || new Map();

		this.plugin.settings.agents.forEach((agent) => {
			const statusItem = container.createDiv("status-item");
			const status = statusMap.get(agent.id);
			
			statusItem.createEl("span", { text: agent.name, cls: "status-name" });
			const statusEl = statusItem.createEl("span", { 
				text: status?.connected ? "connected" : "disconnected",
				cls: `status-indicator status-${status?.connected ? "connected" : "disconnected"}`
			});

			if (status?.lastConnected) {
				statusItem.createEl("span", { 
					text: `Last connected: ${status.lastConnected.toLocaleString()}`,
					cls: "status-time"
				});
			}
		});
	}

	private showAddAgentModal(): void {
		const modal = new AgentConfigModal(this.app, null, async (agent) => {
			this.plugin.settings.agents.push(agent);
			await this.plugin.saveSettings();
			this.display(); // Refresh the settings display
		});
		modal.open();
	}

	private showEditAgentModal(agent: AgentConfig, index: number): void {
		const modal = new AgentConfigModal(this.app, agent, async (updatedAgent) => {
			this.plugin.settings.agents[index] = updatedAgent;
			await this.plugin.saveSettings();
			this.display(); // Refresh the settings display
		});
		modal.open();
	}

	private testPathPermissions(path: string): { type: string; message: string } {
		const permissions = this.plugin.settings.permissions;
		if (!permissions) {
			return { type: "error", message: "No permission configuration found" };
		}

		// Check denied paths first
		if (this.matchesAnyPattern(path, permissions.deniedPaths)) {
			return { type: "denied", message: `❌ DENIED: Path "${path}" is explicitly denied` };
		}

		// Check read-only paths
		if (this.matchesAnyPattern(path, permissions.readOnlyPaths)) {
			return { type: "readonly", message: `📖 READ-ONLY: Path "${path}" allows read access only` };
		}

		// Check allowed paths (if any are specified)
		if (permissions.allowedPaths.length > 0) {
			if (this.matchesAnyPattern(path, permissions.allowedPaths)) {
				return { type: "allowed", message: `✅ ALLOWED: Path "${path}" has full read/write access` };
			} else {
				return { type: "denied", message: `❌ DENIED: Path "${path}" is not in allowed paths list` };
			}
		}

		// Default: allowed if no specific restrictions
		return { type: "allowed", message: `✅ ALLOWED: Path "${path}" has full read/write access (default)` };
	}

	private matchesAnyPattern(path: string, patterns: string[]): boolean {
		return patterns.some(pattern => {
			// Convert glob pattern to regex
			const regexPattern = pattern
				.replace(/\./g, "\\.")
				.replace(/\*/g, ".*")
				.replace(/\?/g, ".");
			
			const regex = new RegExp(`^${regexPattern}$`);
			return regex.test(path) || path.startsWith(pattern);
		});
	}

	private async connectAllAgents(): Promise<void> {
		const enabledAgents = this.plugin.settings.agents.filter(agent => agent.enabled);
		
		for (const agent of enabledAgents) {
			try {
				await this.plugin.acpClient?.startAgentWithConfig(agent);
			} catch (error) {
				console.error(`Failed to connect agent ${agent.name}:`, error);
			}
		}
	}

	private async disconnectAllAgents(): Promise<void> {
		const connectedAgents = this.plugin.acpClient?.getConnectedAgents() || [];
		
		for (const agentId of connectedAgents) {
			try {
				await this.plugin.acpClient?.stopAgentById(agentId);
			} catch (error) {
				console.error(`Failed to disconnect agent ${agentId}:`, error);
			}
		}
	}

	private runConnectionDiagnostics(container: HTMLElement): void {
		const diagnosticsResult = container.createDiv("diagnostics-result");
		diagnosticsResult.empty();
		
		diagnosticsResult.createEl("h5", { text: "Running diagnostics..." });
		
		const results: string[] = [];
		
		// Check agent configurations
		this.plugin.settings.agents.forEach(agent => {
			results.push(`Agent "${agent.name}":`);
			
			// Check command exists (basic validation)
			if (!agent.command) {
				results.push(`  ❌ No command specified`);
			} else {
				results.push(`  ✅ Command: ${agent.command}`);
			}
			
			// Check working directory
			if (agent.workingDirectory) {
				results.push(`  📁 Working directory: ${agent.workingDirectory}`);
			}
			
			// Check connection status
			const status = this.plugin.acpClient?.getConnectionStatus(agent.id);
			results.push(`  🔗 Status: ${status?.connected ? "connected" : "disconnected"}`);
			
			results.push("");
		});
		
		// Display results
		setTimeout(() => {
			diagnosticsResult.empty();
			diagnosticsResult.createEl("h5", { text: "Diagnostics Results" });
			
			const resultText = diagnosticsResult.createEl("pre", { cls: "diagnostics-output" });
			resultText.textContent = results.join("\n");
		}, 1000);
	}

	private displayConnectionLogs(container: HTMLElement): void {
		container.empty();
		
		// Get connection statistics
		const stats = this.plugin.acpClient?.getStats();
		
		if (!stats) {
			container.createEl("p", { text: "No connection statistics available", cls: "setting-item-description" });
			return;
		}
		
		const logContainer = container.createDiv("connection-log-container");
		
		// Connection statistics
		const statsEl = logContainer.createDiv("connection-stats");
		statsEl.createEl("h5", { text: "Connection Statistics" });
		
		const statsList = statsEl.createEl("ul");
		statsList.createEl("li", { text: `Total Connections: ${stats.totalConnections}` });
		statsList.createEl("li", { text: `Connected Agents: ${stats.connectedAgents}` });
		
		// Process statistics
		if (stats.processStats.size > 0) {
			const processStatsEl = logContainer.createDiv("process-stats");
			processStatsEl.createEl("h5", { text: "Process Statistics" });
			
			const processStatsList = processStatsEl.createEl("ul");
			for (const [agentId, health] of stats.processStats) {
				processStatsList.createEl("li", { text: `${agentId}: ${health.status} (errors: ${health.errorCount}, restarts: ${health.restartCount})` });
			}
		}
		
		// Transport statistics (if available)
		if (stats.transportStats.size > 0) {
			const transportStatsEl = logContainer.createDiv("transport-stats");
			transportStatsEl.createEl("h5", { text: "Transport Statistics" });
			
			const transportStatsList = transportStatsEl.createEl("div", { cls: "activity-list" });
			for (const [agentId, transportStat] of stats.transportStats) {
				const statItem = transportStatsList.createDiv("activity-item");
				statItem.createEl("span", { text: agentId, cls: "activity-event" });
				statItem.createEl("span", { text: `Messages: ${transportStat.jsonRpcStats?.messagesSent || 0} sent, ${transportStat.jsonRpcStats?.messagesReceived || 0} received`, cls: "activity-details" });
			}
		}
		
		// Clear logs button
		new Setting(container)
			.setName("Clear Connection Logs")
			.setDesc("Clear all connection logs and statistics")
			.addButton((button) =>
				button
					.setButtonText("Clear Logs")
					.setWarning()
					.onClick(() => {
						// This would need to be implemented in the ACP client

						this.displayConnectionLogs(container);
					})
			);
	}
}

class AgentConfigModal extends Modal {
	private agent: AgentConfig | null;
	private onSave: (agent: AgentConfig) => Promise<void>;
	private nameInput: HTMLInputElement;
	private commandInput: HTMLInputElement;
	private argsInput: HTMLInputElement;
	private workingDirInput: HTMLInputElement;
	private environmentInput: HTMLTextAreaElement;

	constructor(app: App, agent: AgentConfig | null, onSave: (agent: AgentConfig) => Promise<void>) {
		super(app);
		this.agent = agent;
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: this.agent ? "Edit Agent" : "Add New Agent" });

		// Agent Name
		const nameContainer = contentEl.createDiv("setting-item");
		nameContainer.createEl("div", { text: "Agent Name", cls: "setting-item-name" });
		nameContainer.createEl("div", { text: "Display name for this agent", cls: "setting-item-description" });
		this.nameInput = nameContainer.createEl("input", { type: "text", placeholder: "My AI Assistant" });
		this.nameInput.value = this.agent?.name || "";

		// Command
		const commandContainer = contentEl.createDiv("setting-item");
		commandContainer.createEl("div", { text: "Command", cls: "setting-item-name" });
		commandContainer.createEl("div", { text: "Executable command to start the agent", cls: "setting-item-description" });
		this.commandInput = commandContainer.createEl("input", { type: "text", placeholder: "python" });
		this.commandInput.value = this.agent?.command || "";

		// Arguments
		const argsContainer = contentEl.createDiv("setting-item");
		argsContainer.createEl("div", { text: "Arguments", cls: "setting-item-name" });
		argsContainer.createEl("div", { text: "Command line arguments (space-separated)", cls: "setting-item-description" });
		this.argsInput = argsContainer.createEl("input", { type: "text", placeholder: "-m my_agent --acp" });
		this.argsInput.value = this.agent?.args?.join(" ") || "";

		// Working Directory
		const workingDirContainer = contentEl.createDiv("setting-item");
		workingDirContainer.createEl("div", { text: "Working Directory", cls: "setting-item-name" });
		workingDirContainer.createEl("div", { text: "Working directory for the agent process (optional)", cls: "setting-item-description" });
		this.workingDirInput = workingDirContainer.createEl("input", { type: "text", placeholder: "/path/to/agent" });
		this.workingDirInput.value = this.agent?.workingDirectory || "";

		// Environment Variables
		const envContainer = contentEl.createDiv("setting-item");
		envContainer.createEl("div", { text: "Environment Variables", cls: "setting-item-name" });
		envContainer.createEl("div", { text: "Environment variables (KEY=value, one per line)", cls: "setting-item-description" });
		this.environmentInput = envContainer.createEl("textarea", { placeholder: "API_KEY=your_key\nDEBUG=true" });
		this.environmentInput.rows = 4;
		if (this.agent?.environment) {
			this.environmentInput.value = Object.entries(this.agent.environment)
				.map(([key, value]) => `${key}=${value}`)
				.join("\n");
		}

		// Buttons
		const buttonContainer = contentEl.createDiv("modal-button-container");
		
		const saveButton = buttonContainer.createEl("button", { text: "Save", cls: "mod-cta" });
		saveButton.addEventListener("click", () => this.handleSave());

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => this.close());

		// Focus the name input
		this.nameInput.focus();
	}

	private async handleSave(): Promise<void> {
		const name = this.nameInput.value.trim();
		const command = this.commandInput.value.trim();
		const argsString = this.argsInput.value.trim();
		const workingDirectory = this.workingDirInput.value.trim() || undefined;

		if (!name) {
			alert("Agent name is required");
			return;
		}

		if (!command) {
			alert("Command is required");
			return;
		}

		// Parse arguments
		const args = argsString ? argsString.split(/\s+/) : [];

		// Parse environment variables
		const environment: Record<string, string> = {};
		const envLines = this.environmentInput.value.trim().split("\n");
		for (const line of envLines) {
			const trimmedLine = line.trim();
			if (trimmedLine) {
				const [key, ...valueParts] = trimmedLine.split("=");
				if (key && valueParts.length > 0) {
					environment[key.trim()] = valueParts.join("=").trim();
				}
			}
		}

		const agent: AgentConfig = {
			id: this.agent?.id || `agent-${Date.now()}`,
			name,
			command,
			args,
			workingDirectory,
			environment: Object.keys(environment).length > 0 ? environment : undefined,
			enabled: this.agent?.enabled ?? true,
		};

		try {
			await this.onSave(agent);
			this.close();
		} catch (error) {
			alert(`Failed to save agent: ${error.message}`);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ConnectionStatusModal extends Modal {
	private statusLines: string[];

	constructor(app: App, statusLines: string[]) {
		super(app);
		this.statusLines = statusLines;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "ACP Connection Status" });

		const statusContainer = contentEl.createDiv("connection-status-display");
		statusContainer.style.padding = "1rem 0";

		this.statusLines.forEach(line => {
			const statusItem = statusContainer.createDiv("status-display-item");
			statusItem.style.padding = "0.5rem 0";
			statusItem.style.borderBottom = "1px solid var(--background-modifier-border)";
			statusItem.textContent = line;
		});

		// Close button
		const buttonContainer = contentEl.createDiv("modal-button-container");
		const closeButton = buttonContainer.createEl("button", { text: "Close", cls: "mod-cta" });
		closeButton.addEventListener("click", () => this.close());
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ChangeHistoryModal extends Modal {
	private fileOperationsHandler: ObsidianFileOperationsHandler;
	private trackedFiles: string[];

	constructor(app: App, fileOperationsHandler: ObsidianFileOperationsHandler, trackedFiles: string[]) {
		super(app);
		this.fileOperationsHandler = fileOperationsHandler;
		this.trackedFiles = trackedFiles;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "ACP File Change History" });

		const historyContainer = contentEl.createDiv("change-history-display");
		historyContainer.style.padding = "1rem 0";
		historyContainer.style.maxHeight = "400px";
		historyContainer.style.overflowY = "auto";

		this.trackedFiles.forEach(filePath => {
			const changes = this.fileOperationsHandler.getChangeHistory(filePath);
			if (changes.length === 0) return;

			const fileSection = historyContainer.createDiv("file-history-section");
			fileSection.style.marginBottom = "1rem";
			fileSection.style.padding = "0.5rem";
			fileSection.style.border = "1px solid var(--background-modifier-border)";
			fileSection.style.borderRadius = "4px";

			const fileHeader = fileSection.createEl("h4", { text: filePath });
			fileHeader.style.margin = "0 0 0.5rem 0";
			fileHeader.style.color = "var(--text-accent)";

			changes.forEach((change, index) => {
				const changeItem = fileSection.createDiv("change-item");
				changeItem.style.padding = "0.25rem 0";
				changeItem.style.borderBottom = "1px solid var(--background-modifier-border-focus)";
				changeItem.style.fontSize = "0.9em";

				const changeInfo = changeItem.createDiv();
				changeInfo.textContent = `${change.type.toUpperCase()} - ${change.timestamp.toLocaleString()}`;
				changeInfo.style.color = "var(--text-muted)";

				// Add undo button for the latest change
				if (index === changes.length - 1) {
					const undoButton = changeItem.createEl("button", { 
						text: "Undo", 
						cls: "mod-warning" 
					});
					undoButton.style.marginLeft = "1rem";
					undoButton.style.fontSize = "0.8em";
					undoButton.addEventListener("click", async () => {
						const success = await this.fileOperationsHandler.undoLastOperation(filePath);
						if (success) {
							new Notice(`Undid operation on ${filePath}`);
							this.close();
						} else {
							new Notice("Failed to undo operation");
						}
					});
				}
			});
		});

		// Buttons
		const buttonContainer = contentEl.createDiv("modal-button-container");
		
		const clearAllButton = buttonContainer.createEl("button", { 
			text: "Clear All History", 
			cls: "mod-warning" 
		});
		clearAllButton.addEventListener("click", () => {
			this.fileOperationsHandler.clearChangeHistory();
			new Notice("Cleared all ACP file change history");
			this.close();
		});

		const closeButton = buttonContainer.createEl("button", { text: "Close", cls: "mod-cta" });
		closeButton.addEventListener("click", () => this.close());
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}