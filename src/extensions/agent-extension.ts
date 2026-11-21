import type { AgentConfig } from '../core/agent-process-manager';

export interface AgentExtensionContext {
	/** Feed a translated update into the standard session update pipeline. */
	emitSessionUpdate(sessionId: string, update: Record<string, any>): void;
	/** Send a (non-standard) JSON-RPC request to the agent. */
	request(method: string, params: Record<string, any>): Promise<any>;
}

export type PanelTone = 'success' | 'warning' | 'error' | 'muted';

export interface PanelItem {
	label: string;
	description?: string;
	/** Status shown as an icon (Obsidian icon name) with `text` as its tooltip; text badge if no icon. */
	badge?: { text: string; tone?: PanelTone; icon?: string };
	/** Icon button (Obsidian icon name) that runs a slash command (e.g. "/mcp auth figma"). */
	action?: { label: string; command: string; icon?: string };
}

export interface PanelSection {
	heading?: string;
	items: PanelItem[];
	/** Shown when `items` is empty. */
	empty?: string;
}

/** Structured command output, rendered by the chat view in a closable panel. */
export interface CommandPanel {
	title: string;
	/** Short status line, e.g. the result of an action. */
	message?: { text: string; tone?: PanelTone };
	sections?: PanelSection[];
	/** Close the panel automatically after this many ms; omit to keep it until closed. */
	autoCloseMs?: number;
}

/**
 * A slash command implemented by the client through agent-specific methods.
 * It is listed with the agent's own commands but never sent to the agent as a prompt.
 */
export interface ExtensionCommand {
	/** Name without the leading slash. */
	name: string;
	description: string;
	/** Placeholder shown for the command arguments. */
	hint?: string;
	run(
		args: string,
		sessionId: string,
		ctx: AgentExtensionContext
	): Promise<CommandPanel>;
}

/**
 * Client-specific protocol extensions (non-ACP methods) live behind this interface,
 * so the core client only speaks the standard spec.
 */
export interface AgentExtension {
	id: string;
	matches(config: AgentConfig): boolean;
	/** Notification method name -> handler; translate into session updates via ctx. */
	notifications: Record<
		string,
		(params: any, ctx: AgentExtensionContext) => void
	>;
	commands?: ExtensionCommand[];
	/** Extra client capabilities advertised to this agent under `_meta.<id>` in `initialize`. */
	clientCapabilities?: Record<string, unknown>;
	/**
	 * Key that groups permission requests the user answers once, e.g. the several
	 * consent rounds an agent raises for one compound shell command. Return
	 * undefined for requests that must always be asked individually.
	 */
	permissionGroupKey?(params: any): string | undefined;
	/** Requests the agent sends to the client (method name -> handler). */
	requests?: Record<
		string,
		(params: any, ctx: AgentExtensionContext) => Promise<any>
	>;
}
