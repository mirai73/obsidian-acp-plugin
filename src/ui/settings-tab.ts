import {
  App,
  PluginSettingTab,
  Setting,
  SettingGroup,
  Modal,
  Notice,
} from 'obsidian';

import type ACPChatPlugin from '../../main';
import { AgentConfig, DEFAULT_SETTINGS } from '../types/plugin';
import { ObsidianFileOperationsHandler } from '../core/obsidian-file-operations';

export class ACPChatSettingTab extends PluginSettingTab {
  plugin: ACPChatPlugin;

  constructor(app: App, plugin: ACPChatPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    // Agent Configuration Section
    this.displayAgentConfiguration(containerEl);

    const permissionGroup = new SettingGroup(containerEl).setHeading(
      'Permissions'
    );
    // Permission Configuration Section
    this.displayPermissionConfiguration(permissionGroup);
    const connectionGroup = new SettingGroup(containerEl).setHeading(
      'Connection Management'
    );
    // Connection Management Section
    this.displayConnectionManagement(connectionGroup);

    const uiGroup = new SettingGroup(containerEl).setHeading(
      'UI Configuration'
    );
    // UI Configuration Section
    this.displayUIConfiguration(uiGroup);
  }

  private displayAgentConfiguration(containerEl: HTMLElement): void {
    const defaultGroup = new SettingGroup(containerEl);
    defaultGroup.addSetting((setting) =>
      setting
        .setName('Add New Agent')
        .setDesc('Add a new AI assistant configuration')
        .addButton((button) =>
          button
            .setButtonText('Add Agent')
            .setCta()
            .onClick(() => {
              this.showAddAgentModal();
            })
        )
    );

    // Agent list container
    const agentListContainer = containerEl.createDiv('agent-list-container');
    this.refreshAgentList(agentListContainer);

    // Default agent dropdown
    const defaultAgentSetting = new Setting(containerEl)
      .setName('Default Agent')
      .setDesc('The agent used by default when sending messages');
    this.refreshDefaultAgentDropdown(defaultAgentSetting);

    // Add new agent button
  }

  private refreshDefaultAgentDropdown(setting: Setting): void {
    setting.clear();
    setting.addDropdown((dropdown) => {
      dropdown.addOption('', '— None —');
      this.plugin.settings.agents.forEach((a) =>
        dropdown.addOption(a.id, a.name)
      );
      dropdown.setValue(this.plugin.settings.defaultAgentId ?? '');
      dropdown.onChange(async (value) => {
        this.plugin.settings.defaultAgentId = value || null;
        await this.plugin.saveSettings();
      });
    });
  }

  private refreshAgentList(container: HTMLElement): void {
    container.empty();

    if (this.plugin.settings.agents.length === 0) {
      container.createEl('p', {
        text: 'No agents configured. Add an agent to get started.',
        cls: 'setting-item-description',
      });
      return;
    }

    this.plugin.settings.agents.forEach((agent, index) => {
      const connectionStatus = this.plugin.acpClient?.getConnectionStatus(
        agent.id
      );
      const isConnected = connectionStatus?.connected;

      const descFragment = document.createDocumentFragment();

      if (agent.workingDirectory) {
        descFragment.appendChild(document.createElement('br'));
        descFragment.appendText(`Working Directory: ${agent.workingDirectory}`);
      }
      descFragment.appendChild(document.createElement('br'));

      const statusSpan = document.createElement('span');
      statusSpan.style.fontWeight = 'bold';
      statusSpan.style.color = isConnected
        ? 'var(--color-green)'
        : 'var(--text-muted)';
      statusSpan.textContent = isConnected ? 'CONNECTED' : 'DISCONNECTED';
      descFragment.appendChild(statusSpan);

      const setting = new Setting(container)
        .setName(agent.name)
        .setDesc(descFragment);

      // Align items to top so buttons are on the same row as the name
      setting.settingEl.style.alignItems = 'flex-start';

      // Enable/Disable toggle
      setting.addToggle((toggle) => {
        toggle
          .setValue(agent.enabled)
          .setTooltip(agent.enabled ? 'Disable Agent' : 'Enable Agent')
          .onChange(async (value) => {
            agent.enabled = value;
            await this.plugin.saveSettings();
            // Refresh to reflect changes
            this.refreshAgentList(container);
          });
      });

      // Connect/Disconnect button
      setting.addButton((button) => {
        button
          .setButtonText(isConnected ? 'Disconnect' : 'Connect')
          .setTooltip(
            isConnected ? 'Disconnect from agent' : 'Connect to agent'
          )
          .onClick(async () => {
            button.setDisabled(true);
            try {
              if (isConnected) {
                await this.plugin.acpClient?.stopAgentById(agent.id);
              } else {
                await this.plugin.acpClient?.startAgentWithConfig(agent);
              }
            } catch (e) {
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
      setting.addButton((button) => {
        button
          .setIcon('pencil')
          .setTooltip('Edit Agent Configuration')
          .onClick(() => {
            this.showEditAgentModal(agent, index);
          });
      });

      // Delete button
      setting.addButton((button) => {
        button
          .setIcon('trash')
          .setTooltip('Delete Agent')
          .setClass('mod-warning')
          .onClick(async () => {
            if (
              confirm(`Are you sure you want to delete agent "${agent.name}"?`)
            ) {
              this.plugin.settings.agents.splice(index, 1);
              if (this.plugin.settings.defaultAgentId === agent.id) {
                this.plugin.settings.defaultAgentId = null;
              }
              await this.plugin.saveSettings();
              this.display();
            }
          });
      });
    });
  }

  private displayPermissionConfiguration(group: SettingGroup): void {
    group.addSetting((setting) =>
      setting
        .setName('Require Permission Confirmation')
        .setDesc('Require user confirmation for file operations')
        .addToggle((toggle) =>
          toggle
            .setValue(
              this.plugin.settings.permissions?.requireConfirmation ?? true
            )
            .onChange(async (value) => {
              if (!this.plugin.settings.permissions) {
                this.plugin.settings.permissions =
                  DEFAULT_SETTINGS.permissions!;
              }
              this.plugin.settings.permissions.requireConfirmation = value;
              await this.plugin.saveSettings();
            })
        )
    );

    group.addSetting((setting) =>
      setting
        .setName('Show Permission Dialog')
        .setDesc('Show detailed permission dialog with operation details')
        .addToggle((toggle) =>
          toggle
            .setValue(
              this.plugin.settings.permissions?.showPermissionDialog ?? true
            )
            .onChange(async (value) => {
              if (!this.plugin.settings.permissions) {
                this.plugin.settings.permissions =
                  DEFAULT_SETTINGS.permissions!;
              }
              this.plugin.settings.permissions.showPermissionDialog = value;
              await this.plugin.saveSettings();
            })
        )
    );

    group.addSetting((setting) =>
      setting
        .setName('Log Operations')
        .setDesc('Log all file operations performed by AI assistants')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.permissions?.logOperations ?? true)
            .onChange(async (value) => {
              if (!this.plugin.settings.permissions) {
                this.plugin.settings.permissions =
                  DEFAULT_SETTINGS.permissions!;
              }
              this.plugin.settings.permissions.logOperations = value;
              await this.plugin.saveSettings();
            })
        )
    );

    // Permission paths configuration

    // Allowed paths configuration
    group.addSetting((setting) =>
      setting
        .setName('Allowed Paths')
        .setDesc(
          'Paths that AI assistants can access (leave empty to allow all vault files)'
        )
        .addTextArea((text) => {
          text.setValue(
            this.plugin.settings.permissions?.allowedPaths?.join('\n') || ''
          );
          text.setPlaceholder(
            'Enter one path per line\nExample:\nfolder/\n*.md\nspecific-file.txt'
          );
          text.onChange(async (value) => {
            if (!this.plugin.settings.permissions) {
              this.plugin.settings.permissions = DEFAULT_SETTINGS.permissions!;
            }
            this.plugin.settings.permissions.allowedPaths = value
              .split('\n')
              .map((path) => path.trim())
              .filter((path) => path.length > 0);
            await this.plugin.saveSettings();
          });
        })
    );

    // Read-only paths configuration
    group.addSetting((setting) =>
      setting
        .setName('Read-Only Paths')
        .setDesc('Paths that AI assistants can read but not modify')
        .addTextArea((text) => {
          text.setValue(
            this.plugin.settings.permissions?.readOnlyPaths?.join('\n') || ''
          );
          text.setPlaceholder(
            'Enter one path per line\nExample:\ntemplates/\nreference/\n*.template'
          );
          text.onChange(async (value) => {
            if (!this.plugin.settings.permissions) {
              this.plugin.settings.permissions = DEFAULT_SETTINGS.permissions!;
            }
            this.plugin.settings.permissions.readOnlyPaths = value
              .split('\n')
              .map((path) => path.trim())
              .filter((path) => path.length > 0);
            await this.plugin.saveSettings();
          });
        })
    );

    // Denied paths configuration
    group.addSetting((setting) =>
      setting
        .setName('Denied Paths')
        .setDesc('Paths that AI assistants cannot access at all')
        .addTextArea((text) => {
          text.setValue(
            this.plugin.settings.permissions?.deniedPaths?.join('\n') || ''
          );
          text.setPlaceholder(
            'Enter one path per line\nExample:\nprivate/\nsecrets.md\n*.key'
          );
          text.onChange(async (value) => {
            if (!this.plugin.settings.permissions) {
              this.plugin.settings.permissions = DEFAULT_SETTINGS.permissions!;
            }
            this.plugin.settings.permissions.deniedPaths = value
              .split('\n')
              .map((path) => path.trim())
              .filter((path) => path.length > 0);
            await this.plugin.saveSettings();
          });
        })
    );
  }

  private displayConnectionManagement(group: SettingGroup): void {
    group.addSetting((setting) =>
      setting
        .setName('Auto Reconnect')
        .setDesc('Automatically attempt to reconnect when connection is lost')
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
        )
    );

    group.addSetting((setting) =>
      setting
        .setName('Reconnect Interval')
        .setDesc('Time between reconnection attempts (seconds)')
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
        )
    );

    group.addSetting((setting) =>
      setting
        .setName('Max Reconnect Attempts')
        .setDesc('Maximum number of reconnection attempts before giving up')
        .addSlider((slider) =>
          slider
            .setLimits(1, 10, 1)
            .setValue(
              this.plugin.settings.connection?.maxReconnectAttempts ?? 3
            )
            .setDynamicTooltip()
            .onChange(async (value) => {
              if (!this.plugin.settings.connection) {
                this.plugin.settings.connection = DEFAULT_SETTINGS.connection!;
              }
              this.plugin.settings.connection.maxReconnectAttempts = value;
              await this.plugin.saveSettings();
            })
        )
    );

    group.addSetting((setting) =>
      setting
        .setName('Connection Timeout')
        .setDesc('Timeout for initial connection attempts (seconds)')
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
        )
    );
  }

  private displayUIConfiguration(group: SettingGroup): void {
    group.addSetting((setting) =>
      setting
        .setName('Show Timestamps')
        .setDesc('Show timestamps in chat messages')
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
        )
    );

    group.addSetting((setting) =>
      setting
        .setName('Enable Markdown')
        .setDesc('Enable markdown rendering in assistant responses')
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
        )
    );

    group.addSetting((setting) =>
      setting
        .setName('Show File Operation Notifications')
        .setDesc('Show notifications when AI assistants modify files')
        .addToggle((toggle) =>
          toggle
            .setValue(
              this.plugin.settings.ui?.showFileOperationNotifications ?? false
            )
            .onChange(async (value) => {
              if (!this.plugin.settings.ui) {
                this.plugin.settings.ui = DEFAULT_SETTINGS.ui!;
              }
              this.plugin.settings.ui.showFileOperationNotifications = value;
              await this.plugin.saveSettings();
            })
        )
    );
  }

  private refreshConnectionStatus(container: HTMLElement): void {
    container.empty();

    if (this.plugin.settings.agents.length === 0) {
      container.createEl('p', {
        text: 'No agents configured.',
        cls: 'setting-item-description',
      });
      return;
    }

    const statusMap =
      this.plugin.acpClient?.getAllConnectionStatuses() || new Map();

    this.plugin.settings.agents.forEach((agent) => {
      const statusItem = container.createDiv('status-item');
      const status = statusMap.get(agent.id);

      statusItem.createEl('span', { text: agent.name, cls: 'status-name' });
      const statusEl = statusItem.createEl('span', {
        text: status?.connected ? 'connected' : 'disconnected',
        cls: `status-indicator status-${status?.connected ? 'connected' : 'disconnected'}`,
      });

      if (status?.lastConnected) {
        statusItem.createEl('span', {
          text: `Last connected: ${status.lastConnected.toLocaleString()}`,
          cls: 'status-time',
        });
      }
    });
  }

  private showAddAgentModal(): void {
    const modal = new AgentConfigModal(this.app, null, async (agent) => {
      if (this.plugin.settings.agents.some((a) => a.name === agent.name)) {
        alert(`An agent named "${agent.name}" already exists.`);
        return;
      }
      this.plugin.settings.agents.push(agent);
      await this.plugin.saveSettings();
      this.display(); // Refresh the settings display
    });
    modal.open();
  }

  private showEditAgentModal(agent: AgentConfig, index: number): void {
    const modal = new AgentConfigModal(
      this.app,
      agent,
      async (updatedAgent) => {
        if (
          updatedAgent.name !== agent.name &&
          this.plugin.settings.agents.some((a) => a.name === updatedAgent.name)
        ) {
          alert(`An agent named "${updatedAgent.name}" already exists.`);
          return;
        }
        this.plugin.settings.agents[index] = updatedAgent;
        if (this.plugin.settings.defaultAgentId === agent.id) {
          this.plugin.settings.defaultAgentId = updatedAgent.id;
        }
        await this.plugin.saveSettings();
        this.display(); // Refresh the settings display
      }
    );
    modal.open();
  }

  private testPathPermissions(path: string): { type: string; message: string } {
    const permissions = this.plugin.settings.permissions;
    if (!permissions) {
      return { type: 'error', message: 'No permission configuration found' };
    }

    // Check denied paths first
    if (this.matchesAnyPattern(path, permissions.deniedPaths)) {
      return {
        type: 'denied',
        message: `❌ DENIED: Path "${path}" is explicitly denied`,
      };
    }

    // Check read-only paths
    if (this.matchesAnyPattern(path, permissions.readOnlyPaths)) {
      return {
        type: 'readonly',
        message: `📖 READ-ONLY: Path "${path}" allows read access only`,
      };
    }

    // Check allowed paths (if any are specified)
    if (permissions.allowedPaths.length > 0) {
      if (this.matchesAnyPattern(path, permissions.allowedPaths)) {
        return {
          type: 'allowed',
          message: `✅ ALLOWED: Path "${path}" has full read/write access`,
        };
      } else {
        return {
          type: 'denied',
          message: `❌ DENIED: Path "${path}" is not in allowed paths list`,
        };
      }
    }

    // Default: allowed if no specific restrictions
    return {
      type: 'allowed',
      message: `✅ ALLOWED: Path "${path}" has full read/write access (default)`,
    };
  }

  private matchesAnyPattern(path: string, patterns: string[]): boolean {
    return patterns.some((pattern) => {
      // Convert glob pattern to regex
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');

      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(path) || path.startsWith(pattern);
    });
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

  constructor(
    app: App,
    agent: AgentConfig | null,
    onSave: (agent: AgentConfig) => Promise<void>
  ) {
    super(app);
    this.agent = agent;
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', {
      text: this.agent ? 'Edit Agent' : 'Add New Agent',
    });

    // Agent Name
    new Setting(contentEl)
      .setName('Agent Name')
      .setDesc('Display name for this agent')
      .addText((text) => {
        text.setPlaceholder('My AI Assistant');
        text.setValue(this.agent?.name || '');
        this.nameInput = text.inputEl;
        if (this.agent) {
          text.setDisabled(true);
        }
      });

    // Command
    new Setting(contentEl)
      .setName('Command')
      .setDesc('Executable command to start the agent')
      .addText((text) => {
        text.setPlaceholder('python');
        text.setValue(this.agent?.command || '');
        this.commandInput = text.inputEl;
      });

    // Arguments
    new Setting(contentEl)
      .setName('Arguments')
      .setDesc('Command line arguments (space-separated)')
      .addText((text) => {
        text.setPlaceholder('-m my_agent --acp');
        text.setValue(this.agent?.args?.join(' ') || '');
        this.argsInput = text.inputEl;
      });

    // Working Directory
    new Setting(contentEl)
      .setName('Working Directory')
      .setDesc('Working directory for the agent process (optional)')
      .addText((text) => {
        text.setPlaceholder('/path/to/agent');
        text.setValue(this.agent?.workingDirectory || '');
        this.workingDirInput = text.inputEl;
      });

    // Environment Variables
    new Setting(contentEl)
      .setName('Environment Variables')
      .setDesc('Environment variables (KEY=value, one per line)')
      .addTextArea((text) => {
        text.setPlaceholder('API_KEY=your_key\nDEBUG=true');
        text.inputEl.rows = 4;
        if (this.agent?.environment) {
          text.setValue(
            Object.entries(this.agent.environment)
              .map(([key, value]) => `${key}=${value}`)
              .join('\n')
          );
        }
        this.environmentInput = text.inputEl;
      });

    // Buttons
    const buttonContainer = contentEl.createDiv('modal-button-container');

    const saveButton = buttonContainer.createEl('button', {
      text: 'Save',
      cls: 'mod-cta',
    });
    saveButton.addEventListener('click', () => this.handleSave());

    const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelButton.addEventListener('click', () => this.close());

    // Focus the name input
    if (!this.agent) {
      setTimeout(() => this.nameInput.focus(), 50);
    } else {
      setTimeout(() => this.commandInput.focus(), 50);
    }
  }

  private async handleSave(): Promise<void> {
    const name = this.nameInput.value.trim();
    const command = this.commandInput.value.trim();
    const argsString = this.argsInput.value.trim();
    const workingDirectory = this.workingDirInput.value.trim() || undefined;

    if (!name) {
      alert('Agent name is required');
      return;
    }

    if (this.agent?.id && name !== this.agent?.id) {
      alert('Agent name cannot be modified');
      return;
    }

    if (!command) {
      alert('Command is required');
      return;
    }

    // Parse arguments
    const args = argsString ? argsString.split(/\s+/) : [];

    // Parse environment variables
    const environment: Record<string, string> = {};
    const envLines = this.environmentInput.value.trim().split('\n');
    for (const line of envLines) {
      const trimmedLine = line.trim();
      if (trimmedLine) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          environment[key.trim()] = valueParts.join('=').trim();
        }
      }
    }

    const agent: AgentConfig = {
      id: name,
      name,
      command,
      args,
      workingDirectory,
      environment:
        Object.keys(environment).length > 0 ? environment : undefined,
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

export class ConnectionStatusModal extends Modal {
  private statusLines: string[];

  constructor(app: App, statusLines: string[]) {
    super(app);
    this.statusLines = statusLines;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'ACP Connection Status' });

    const statusContainer = contentEl.createDiv('connection-status-display');
    statusContainer.style.padding = '1rem 0';

    this.statusLines.forEach((line) => {
      const statusItem = statusContainer.createDiv('status-display-item');
      statusItem.style.padding = '0.5rem 0';
      statusItem.style.borderBottom =
        '1px solid var(--background-modifier-border)';
      statusItem.textContent = line;
    });

    // Close button
    const buttonContainer = contentEl.createDiv('modal-button-container');
    const closeButton = buttonContainer.createEl('button', {
      text: 'Close',
      cls: 'mod-cta',
    });
    closeButton.addEventListener('click', () => this.close());
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class ChangeHistoryModal extends Modal {
  private fileOperationsHandler: ObsidianFileOperationsHandler;
  private trackedFiles: string[];

  constructor(
    app: App,
    fileOperationsHandler: ObsidianFileOperationsHandler,
    trackedFiles: string[]
  ) {
    super(app);
    this.fileOperationsHandler = fileOperationsHandler;
    this.trackedFiles = trackedFiles;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'ACP File Change History' });

    const historyContainer = contentEl.createDiv('change-history-display');
    historyContainer.style.padding = '1rem 0';
    historyContainer.style.maxHeight = '400px';
    historyContainer.style.overflowY = 'auto';

    this.trackedFiles.forEach((filePath) => {
      const changes = this.fileOperationsHandler.getChangeHistory(filePath);
      if (changes.length === 0) return;

      const fileSection = historyContainer.createDiv('file-history-section');
      fileSection.style.marginBottom = '1rem';
      fileSection.style.padding = '0.5rem';
      fileSection.style.border = '1px solid var(--background-modifier-border)';
      fileSection.style.borderRadius = '4px';

      const fileHeader = fileSection.createEl('h4', { text: filePath });
      fileHeader.style.margin = '0 0 0.5rem 0';
      fileHeader.style.color = 'var(--text-accent)';

      changes.forEach((change, index) => {
        const changeItem = fileSection.createDiv('change-item');
        changeItem.style.padding = '0.25rem 0';
        changeItem.style.borderBottom =
          '1px solid var(--background-modifier-border-focus)';
        changeItem.style.fontSize = '0.9em';

        const changeInfo = changeItem.createDiv();
        changeInfo.textContent = `${change.type.toUpperCase()} - ${change.timestamp.toLocaleString()}`;
        changeInfo.style.color = 'var(--text-muted)';

        // Add undo button for the latest change
        if (index === changes.length - 1) {
          const undoButton = changeItem.createEl('button', {
            text: 'Undo',
            cls: 'mod-warning',
          });
          undoButton.style.marginLeft = '1rem';
          undoButton.style.fontSize = '0.8em';
          undoButton.addEventListener('click', async () => {
            const success =
              await this.fileOperationsHandler.undoLastOperation(filePath);
            if (success) {
              new Notice(`Undid operation on ${filePath}`);
              this.close();
            } else {
              new Notice('Failed to undo operation');
            }
          });
        }
      });
    });

    // Buttons
    const buttonContainer = contentEl.createDiv('modal-button-container');

    const clearAllButton = buttonContainer.createEl('button', {
      text: 'Clear All History',
      cls: 'mod-warning',
    });
    clearAllButton.addEventListener('click', () => {
      this.fileOperationsHandler.clearChangeHistory();
      new Notice('Cleared all ACP file change history');
      this.close();
    });

    const closeButton = buttonContainer.createEl('button', {
      text: 'Close',
      cls: 'mod-cta',
    });
    closeButton.addEventListener('click', () => this.close());
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
