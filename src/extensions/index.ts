import type { AgentExtension } from './agent-extension';
import { kiroExtension } from './kiro-extension';

export type {
	AgentExtension,
	AgentExtensionContext,
	ExtensionCommand,
	CommandPanel,
	PanelItem,
	PanelSection,
	PanelTone,
} from './agent-extension';

/** Add new client-specific extensions here. */
export const builtinExtensions: AgentExtension[] = [kiroExtension];
