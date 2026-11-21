import type {
	AgentExtension,
	ExtensionCommand,
	PanelSection,
	PanelTone,
} from './agent-extension';

interface McpTool {
	name: string;
	description?: string;
	disabled?: boolean;
}

interface McpServer {
	name: string;
	status: string;
	tools?: McpTool[];
	authType?: string;
	failedAuthorization?: boolean;
}

interface ToolTag {
	source: string;
	tag: string;
	description?: string;
}

// Kiro only pushes MCP status and tool tags as notifications, so keep the latest per session.
const mcpServers = new Map<string, McpServer[]>();
const toolTags = new Map<string, ToolTag[]>();

const TRANSIENT_MS = 4000;

const toolsCommand: ExtensionCommand = {
	name: 'tools',
	description: 'Show the tools available in this session',
	async run(_args, sessionId) {
		const tags = toolTags.get(sessionId) ?? [];
		const servers = mcpServers.get(sessionId) ?? [];
		const sections: PanelSection[] = [];

		const builtin = tags.filter((t) => t.source === 'builtin');
		if (builtin.length > 0) {
			sections.push({
				heading: 'Built-in',
				items: builtin.map((t) => ({
					label: t.tag,
					description: t.description,
				})),
			});
		}
		for (const server of servers) {
			if (!server.tools?.length) continue;
			sections.push({
				heading: `MCP: ${server.name}`,
				items: server.tools.map((tool) => ({
					label: tool.name,
					description: tool.description,
					badge: tool.disabled
						? { text: 'disabled', tone: 'muted' as const }
						: undefined,
				})),
			});
		}

		return {
			title: 'Tools',
			message:
				sections.length === 0
					? {
							text: 'No tool information received from Kiro yet.',
							tone: 'muted',
						}
					: undefined,
			sections,
		};
	},
};

const STATUS_TONE: Record<string, PanelTone> = {
	connected: 'success',
	connecting: 'warning',
	failed: 'error',
};

const mcpCommand: ExtensionCommand = {
	name: 'mcp',
	description:
		'Show MCP server status, "reset <server>" to restart one, or "auth <server>" to sign in',
	hint: 'reset|auth <server>',
	async run(args, sessionId, ctx) {
		const [action, ...rest] = args.trim().split(/\s+/).filter(Boolean);

		if (action === 'reset') {
			const serverName = rest.join(' ');
			if (!serverName) {
				return {
					title: 'MCP',
					message: { text: 'Usage: /mcp reset <server>', tone: 'warning' },
					autoCloseMs: TRANSIENT_MS,
				};
			}
			try {
				await ctx.request('_kiro/mcp/resetServer', { sessionId, serverName });
				return {
					title: 'MCP',
					message: {
						text: `Restarting MCP server "${serverName}".`,
						tone: 'success',
					},
					autoCloseMs: TRANSIENT_MS,
				};
			} catch (error: any) {
				return {
					title: 'MCP',
					message: {
						text: `Could not reset "${serverName}": ${error?.message ?? error}`,
						tone: 'error',
					},
				};
			}
		}
		if (action === 'auth') {
			const serverName = rest.join(' ');
			if (!serverName) {
				return {
					title: 'MCP',
					message: { text: 'Usage: /mcp auth <server>', tone: 'warning' },
					autoCloseMs: TRANSIENT_MS,
				};
			}
			// Kiro starts its local OAuth callback listener, then asks us (via
			// _kiro/openExternalUrl) to open the browser. The request only settles
			// once sign-in ends, so don't wait for it beyond catching immediate errors.
			const request = ctx.request('_kiro/mcp/resetServer', {
				sessionId,
				serverName,
				startOAuth: true,
			});
			const failure = await Promise.race([
				request.then(
					() => null,
					(error: any) => error
				),
				new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
			]);
			if (failure) {
				return {
					title: 'MCP',
					message: {
						text: `Could not start sign-in for "${serverName}": ${failure?.message ?? failure}`,
						tone: 'error',
					},
				};
			}
			return {
				title: 'MCP',
				message: {
					text: `Opening your browser to sign in to "${serverName}". Run /mcp afterwards to check the status.`,
					tone: 'success',
				},
				autoCloseMs: TRANSIENT_MS * 2,
			};
		}
		if (action) {
			return {
				title: 'MCP',
				message: {
					text: 'Usage: /mcp, /mcp reset <server> or /mcp auth <server>',
					tone: 'warning',
				},
				autoCloseMs: TRANSIENT_MS,
			};
		}

		const servers = mcpServers.get(sessionId) ?? [];
		return {
			title: 'MCP servers',
			sections: [
				{
					items: servers.map((server) => {
						const count = server.tools?.length;
						return {
							label: server.name,
							description: count === undefined ? undefined : `${count} tool(s)`,
							badge: {
								text: server.status,
								tone: STATUS_TONE[server.status] ?? 'muted',
							},
							action: server.failedAuthorization
								? {
										label: 'Sign in',
										command: `/mcp auth ${server.name}`,
									}
								: undefined,
						};
					}),
					empty: 'No MCP servers reported for this session.',
				},
			],
		};
	},
};

const compactCommand: ExtensionCommand = {
	name: 'compact',
	description: 'Summarize the conversation to free up context',
	async run(_args, sessionId, ctx) {
		try {
			await ctx.request('_kiro/session/compact', { sessionId });
			return {
				title: 'Compact',
				message: { text: 'Conversation compacted.', tone: 'success' },
				autoCloseMs: TRANSIENT_MS,
			};
		} catch (error: any) {
			return {
				title: 'Compact',
				message: {
					text: `Could not compact: ${error?.message ?? error}`,
					tone: 'error',
				},
			};
		}
	},
};

export const kiroExtension: AgentExtension = {
	id: 'kiro',

	matches: (config) =>
		[config.id, config.name, config.command].some((v) =>
			v?.toLowerCase().includes('kiro')
		),

	// CLI V3 reports commands, mode, usage and subagents via standard session/update.
	notifications: {
		'_kiro/mcp/status': (params) => {
			if (params?.sessionId && Array.isArray(params.servers)) {
				mcpServers.set(params.sessionId, params.servers);
			}
		},
		'_kiro/tools/didChange': (params) => {
			if (params?.sessionId && Array.isArray(params.tags)) {
				toolTags.set(params.sessionId, params.tags);
			}
		},
	},

	commands: [toolsCommand, mcpCommand, compactCommand],

	// Kiro asks once per sub-command of a compound command (`a; b` -> two requests with the
	// same toolCallId, each with `consent.resource` set to the full command). One answer covers all.
	permissionGroupKey: (params) => {
		const consent = params?._meta?.kiro?.consent;
		const toolCallId = params?.toolCall?.toolCallId;
		if (!params?.sessionId || !toolCallId || !consent?.resource)
			return undefined;
		return [
			params.sessionId,
			toolCallId,
			consent.capability,
			consent.resource,
		].join('|');
	},

	// Lets Kiro hand us OAuth sign-in URLs; without it Kiro neither opens the browser
	// nor keeps its local callback listener running.
	clientCapabilities: { openExternalUrl: true },

	requests: {
		'_kiro/openExternalUrl': async (params) => {
			const url = typeof params?.url === 'string' ? params.url : '';
			if (!/^https?:\/\//i.test(url)) {
				throw new Error('Refusing to open a non-http(s) URL');
			}
			window.open(url, '_blank');
			return null;
		},
	},
};
