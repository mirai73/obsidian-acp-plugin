import type { AgentConfig } from '../core/agent-process-manager';

export interface AgentExtensionContext {
	/** Feed a translated update into the standard session update pipeline. */
	emitSessionUpdate(sessionId: string, update: Record<string, any>): void;
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
}
