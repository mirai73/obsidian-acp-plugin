/**
 * Permission Dialog Modal
 * Shows permission requests from agents with user-selectable options
 */

import { App, Modal, Setting } from 'obsidian';

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
}

export interface PermissionRequest {
  sessionId: string;
  toolCall?: {
    toolCallId: string;
    title: string;
  };
  options: PermissionOption[];
  operation?: string;
  resource?: string;
  reason?: string;
}

export class PermissionDialog extends Modal {
  private request: PermissionRequest;
  private resolve: (optionId: string | null) => void;
  private selectedOptionId: string | null = null;

  constructor(app: App, request: PermissionRequest) {
    super(app);
    this.request = request;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('acp-permission-dialog');

    // Title
    contentEl.createEl('h2', { text: 'Agent Permission Request' });

    // Request details
    const detailsContainer = contentEl.createDiv('permission-details');
    
    if (this.request.toolCall?.title) {
      detailsContainer.createEl('p', { 
        text: `Tool: ${this.request.toolCall.title}`,
        cls: 'permission-tool-title'
      });
    }

    if (this.request.operation) {
      detailsContainer.createEl('p', { 
        text: `Operation: ${this.request.operation}`,
        cls: 'permission-operation'
      });
    }

    if (this.request.resource) {
      detailsContainer.createEl('p', { 
        text: `Resource: ${this.request.resource}`,
        cls: 'permission-resource'
      });
    }

    if (this.request.reason) {
      detailsContainer.createEl('p', { 
        text: `Reason: ${this.request.reason}`,
        cls: 'permission-reason'
      });
    }

    // Session info
    detailsContainer.createEl('p', { 
      text: `Session: ${this.request.sessionId.substring(0, 8)}...`,
      cls: 'permission-session'
    });

    // Options
    const optionsContainer = contentEl.createDiv('permission-options');
    optionsContainer.createEl('h3', { text: 'Choose an action:' });

    // Create radio buttons for options
    this.request.options.forEach((option, index) => {
      const optionDiv = optionsContainer.createDiv('permission-option');
      
      const radio = optionDiv.createEl('input', {
        type: 'radio',
        attr: {
          name: 'permission-choice',
          value: option.optionId,
          id: `option-${index}`
        }
      });

      const label = optionDiv.createEl('label', {
        text: option.name,
        attr: { for: `option-${index}` }
      });

      // Add description based on kind
      const description = this.getOptionDescription(option.kind);
      if (description) {
        optionDiv.createEl('span', { 
          text: ` (${description})`,
          cls: 'permission-option-description'
        });
      }

      radio.addEventListener('change', () => {
        if (radio.checked) {
          this.selectedOptionId = option.optionId;
        }
      });

      // Select first option by default
      if (index === 0) {
        radio.checked = true;
        this.selectedOptionId = option.optionId;
      }
    });

    // Buttons
    const buttonContainer = contentEl.createDiv('permission-buttons');
    
    const confirmButton = buttonContainer.createEl('button', {
      text: 'Confirm',
      cls: 'mod-cta'
    });
    
    const cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel'
    });

    confirmButton.addEventListener('click', () => {
      this.resolve(this.selectedOptionId);
      this.close();
    });

    cancelButton.addEventListener('click', () => {
      this.resolve(null);
      this.close();
    });

    // Focus the confirm button
    confirmButton.focus();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private getOptionDescription(kind: string): string {
    switch (kind) {
      case 'allow_once':
        return 'for this request only';
      case 'allow_always':
        return 'for all future requests';
      case 'reject_once':
        return 'deny this request';
      case 'reject_always':
        return 'deny all future requests';
      default:
        return '';
    }
  }

  /**
   * Show the permission dialog and wait for user response
   */
  async showAndWait(): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }
}