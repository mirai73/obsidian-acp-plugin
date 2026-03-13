/**
 * Error Display Component
 * Provides user-friendly error messages in the chat interface
 */

import { ErrorInfo, ErrorSeverity } from '../core/error-handler';
import { LogEntry, LogLevel } from '../core/logging-system';

/**
 * Error display configuration
 */
export interface ErrorDisplayConfig {
	showErrorCodes: boolean;
	showTimestamps: boolean;
	showContext: boolean;
	maxContextItems: number;
	enableRetryActions: boolean;
}

/**
 * Error display component for chat interface
 */
export class ErrorDisplay {
	private config: ErrorDisplayConfig;

	constructor(config: Partial<ErrorDisplayConfig> = {}) {
		this.config = {
			showErrorCodes: false,
			showTimestamps: true,
			showContext: false,
			maxContextItems: 3,
			enableRetryActions: true,
			...config,
		};
	}

	/**
	 * Create user-friendly error message element
	 */
	createErrorMessage(errorInfo: ErrorInfo): HTMLElement {
		const container = document.createElement('div');
		container.className = `error-message severity-${errorInfo.severity}`;

		// Error icon and severity indicator
		const header = document.createElement('div');
		header.className = 'error-header';

		const icon = document.createElement('span');
		icon.className = `error-icon ${this.getSeverityIcon(errorInfo.severity)}`;
		icon.textContent = this.getSeverityEmoji(errorInfo.severity);

		const title = document.createElement('span');
		title.className = 'error-title';
		title.textContent = this.getSeverityTitle(errorInfo.severity);

		header.appendChild(icon);
		header.appendChild(title);
		container.appendChild(header);

		// Main error message
		const message = document.createElement('div');
		message.className = 'error-message-text';
		message.textContent = errorInfo.userMessage;
		container.appendChild(message);

		// Optional error code
		if (this.config.showErrorCodes) {
			const code = document.createElement('div');
			code.className = 'error-code';
			code.textContent = `Error Code: ${errorInfo.code}`;
			container.appendChild(code);
		}

		// Optional timestamp
		if (this.config.showTimestamps) {
			const timestamp = document.createElement('div');
			timestamp.className = 'error-timestamp';
			timestamp.textContent = `${errorInfo.timestamp.toLocaleTimeString()}`;
			container.appendChild(timestamp);
		}

		// Optional context information
		if (this.config.showContext && errorInfo.context) {
			const contextEl = this.createContextDisplay(errorInfo.context);
			container.appendChild(contextEl);
		}

		// Optional retry actions
		if (
			this.config.enableRetryActions &&
			this.shouldShowRetryAction(errorInfo)
		) {
			const actions = this.createRetryActions(errorInfo);
			container.appendChild(actions);
		}

		return container;
	}

	/**
	 * Create connection status indicator
	 */
	createConnectionStatus(
		isConnected: boolean,
		lastError?: string,
		retryCount?: number
	): HTMLElement {
		const container = document.createElement('div');
		container.className = `connection-status ${isConnected ? 'connected' : 'disconnected'}`;

		const indicator = document.createElement('span');
		indicator.className = 'connection-indicator';
		indicator.textContent = isConnected ? '🟢' : '🔴';

		const text = document.createElement('span');
		text.className = 'connection-text';

		if (isConnected) {
			text.textContent = 'Connected to AI assistant';
		} else {
			text.textContent =
				retryCount && retryCount > 0
					? `Reconnecting... (attempt ${retryCount})`
					: 'Disconnected from AI assistant';
		}

		container.appendChild(indicator);
		container.appendChild(text);

		// Show last error if available
		if (lastError && !isConnected) {
			const errorText = document.createElement('div');
			errorText.className = 'connection-error';
			errorText.textContent = lastError;
			container.appendChild(errorText);
		}

		return container;
	}

	/**
	 * Create log entry display for debugging
	 */
	createLogEntryDisplay(entry: LogEntry): HTMLElement {
		const container = document.createElement('div');
		container.className = `log-entry level-${LogLevel[entry.level].toLowerCase()}`;

		const header = document.createElement('div');
		header.className = 'log-header';

		const timestamp = document.createElement('span');
		timestamp.className = 'log-timestamp';
		timestamp.textContent = entry.timestamp.toLocaleTimeString();

		const level = document.createElement('span');
		level.className = 'log-level';
		level.textContent = LogLevel[entry.level];

		const category = document.createElement('span');
		category.className = 'log-category';
		category.textContent = entry.category;

		header.appendChild(timestamp);
		header.appendChild(level);
		header.appendChild(category);
		container.appendChild(header);

		const message = document.createElement('div');
		message.className = 'log-message';
		message.textContent = entry.message;
		container.appendChild(message);

		// Show context if available
		if (entry.context) {
			const context = this.createContextDisplay(entry.context);
			container.appendChild(context);
		}

		// Show error stack if available
		if (entry.error && entry.error.stack) {
			const stack = document.createElement('details');
			stack.className = 'log-stack';

			const summary = document.createElement('summary');
			summary.textContent = 'Stack Trace';
			stack.appendChild(summary);

			const stackText = document.createElement('pre');
			stackText.textContent = entry.error.stack;
			stack.appendChild(stackText);

			container.appendChild(stack);
		}

		return container;
	}

	/**
	 * Create error summary for multiple errors
	 */
	createErrorSummary(errors: ErrorInfo[]): HTMLElement {
		const container = document.createElement('div');
		container.className = 'error-summary';

		const header = document.createElement('div');
		header.className = 'error-summary-header';
		header.textContent = `${errors.length} error${errors.length > 1 ? 's' : ''} occurred`;
		container.appendChild(header);

		// Group errors by severity
		const errorsBySeverity = this.groupErrorsBySeverity(errors);

		Object.entries(errorsBySeverity).forEach(([severity, severityErrors]) => {
			if (severityErrors.length === 0) return;

			const severityGroup = document.createElement('div');
			severityGroup.className = `error-group severity-${severity}`;

			const severityHeader = document.createElement('div');
			severityHeader.className = 'error-group-header';
			severityHeader.textContent = `${this.getSeverityTitle(severity as ErrorSeverity)} (${severityErrors.length})`;
			severityGroup.appendChild(severityHeader);

			const errorList = document.createElement('ul');
			errorList.className = 'error-list';

			severityErrors.slice(0, 5).forEach((error) => {
				// Show max 5 per severity
				const listItem = document.createElement('li');
				listItem.textContent = error.userMessage;
				errorList.appendChild(listItem);
			});

			if (severityErrors.length > 5) {
				const moreItem = document.createElement('li');
				moreItem.className = 'error-more';
				moreItem.textContent = `... and ${severityErrors.length - 5} more`;
				errorList.appendChild(moreItem);
			}

			severityGroup.appendChild(errorList);
			container.appendChild(severityGroup);
		});

		return container;
	}

	/**
	 * Private helper methods
	 */

	private getSeverityIcon(severity: ErrorSeverity): string {
		switch (severity) {
			case ErrorSeverity.LOW:
				return 'info-icon';
			case ErrorSeverity.MEDIUM:
				return 'warning-icon';
			case ErrorSeverity.HIGH:
				return 'error-icon';
			case ErrorSeverity.CRITICAL:
				return 'critical-icon';
			default:
				return 'info-icon';
		}
	}

	private getSeverityEmoji(severity: ErrorSeverity): string {
		switch (severity) {
			case ErrorSeverity.LOW:
				return 'ℹ️';
			case ErrorSeverity.MEDIUM:
				return '⚠️';
			case ErrorSeverity.HIGH:
				return '❌';
			case ErrorSeverity.CRITICAL:
				return '🚨';
			default:
				return 'ℹ️';
		}
	}

	private getSeverityTitle(severity: ErrorSeverity): string {
		switch (severity) {
			case ErrorSeverity.LOW:
				return 'Information';
			case ErrorSeverity.MEDIUM:
				return 'Warning';
			case ErrorSeverity.HIGH:
				return 'Error';
			case ErrorSeverity.CRITICAL:
				return 'Critical Error';
			default:
				return 'Information';
		}
	}

	private createContextDisplay(context: Record<string, any>): HTMLElement {
		const container = document.createElement('details');
		container.className = 'error-context';

		const summary = document.createElement('summary');
		summary.textContent = 'Details';
		container.appendChild(summary);

		const contextList = document.createElement('ul');
		contextList.className = 'context-list';

		const entries = Object.entries(context).slice(
			0,
			this.config.maxContextItems
		);
		entries.forEach(([key, value]) => {
			const item = document.createElement('li');
			item.className = 'context-item';

			const keySpan = document.createElement('span');
			keySpan.className = 'context-key';
			keySpan.textContent = key + ': ';

			const valueSpan = document.createElement('span');
			valueSpan.className = 'context-value';
			valueSpan.textContent =
				typeof value === 'object'
					? JSON.stringify(value, null, 2)
					: String(value);

			item.appendChild(keySpan);
			item.appendChild(valueSpan);
			contextList.appendChild(item);
		});

		if (Object.keys(context).length > this.config.maxContextItems) {
			const moreItem = document.createElement('li');
			moreItem.className = 'context-more';
			moreItem.textContent = `... and ${Object.keys(context).length - this.config.maxContextItems} more`;
			contextList.appendChild(moreItem);
		}

		container.appendChild(contextList);
		return container;
	}

	private shouldShowRetryAction(errorInfo: ErrorInfo): boolean {
		// Show retry for connection and timeout errors
		return (
			errorInfo.message.includes('connection') ||
			errorInfo.message.includes('timeout') ||
			errorInfo.message.includes('network')
		);
	}

	private createRetryActions(errorInfo: ErrorInfo): HTMLElement {
		const container = document.createElement('div');
		container.className = 'error-actions';

		const retryButton = document.createElement('button');
		retryButton.className = 'error-retry-button';
		retryButton.textContent = 'Retry';
		retryButton.onclick = () => {
			// Emit retry event
			const event = new CustomEvent('error-retry', {
				detail: { errorInfo },
			});
			document.dispatchEvent(event);
		};

		container.appendChild(retryButton);
		return container;
	}

	private groupErrorsBySeverity(
		errors: ErrorInfo[]
	): Record<string, ErrorInfo[]> {
		const groups: Record<string, ErrorInfo[]> = {
			[ErrorSeverity.CRITICAL]: [],
			[ErrorSeverity.HIGH]: [],
			[ErrorSeverity.MEDIUM]: [],
			[ErrorSeverity.LOW]: [],
		};

		errors.forEach((error) => {
			groups[error.severity].push(error);
		});

		return groups;
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: Partial<ErrorDisplayConfig>): void {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Get current configuration
	 */
	getConfig(): ErrorDisplayConfig {
		return { ...this.config };
	}
}
