import type { AgentExtension } from './agent-extension';

export const kiroExtension: AgentExtension = {
	id: 'kiro',

	matches: (config) =>
		[config.id, config.name, config.command].some((v) =>
			v?.toLowerCase().includes('kiro')
		),

	// CLI V3 reports commands, mode, usage and subagents via standard session/update.
	notifications: {},
};
