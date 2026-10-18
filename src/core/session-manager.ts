/**
 * Session Manager Implementation
 * Manages ACP session lifecycle, conversation context, and session operations
 */

import { SessionManager, SessionSummary } from '../interfaces/session-manager';
import {
	Message,
	PromptResult,
	SessionUpdate,
	SessionNewParams,
	SessionNewResult,
	SessionPromptParams,
	SessionCancelParams,
	ContentBlock,
	SessionModeState,
	SessionSetModeParams,
	SessionSetModelParams,
	ToolCall,
	ToolCallUpdate,
	AvailableCommand,
} from '../types/acp';
import { JsonRpcClient } from './json-rpc-client';
import { JsonRpcError, JsonRpcErrorCode } from './acp-method-handlers';
import { SessionPersistenceService } from './session-persistence';

export interface SessionManagerOptions {
	defaultTimeout?: number;
	maxSessions?: number;
	sessionTimeout?: number;
	onStreamingChunk?: (sessionId: string, chunk: any) => void;
	persistenceService?: SessionPersistenceService;
}

export interface SessionContext {
	sessionId: string; // The agent's session ID - the only one we need
	agentId: string; // The agent this session belongs to
	jsonRpcClient: JsonRpcClient; // The JSON-RPC client associated with this session's agent
	capabilities: string[];
	messages: Message[];
	createdAt: Date;
	lastActivity: Date;
	status: 'active' | 'cancelled' | 'completed';
	pendingOperations: Set<string>;
	modes?: SessionModeState;
	models?: SessionNewResult['models'];
	/** Set when the agent exposes mode/model via session config options instead of set_mode/set_model. */
	modeConfigId?: string;
	modelConfigId?: string;
	/** Agents spawned during this session, kept in memory so the UI can redraw them. */
	spawnedAgents?: Map<
		string,
		{
			name?: string;
			status?: string;
			/** Index in `messages` where the agent was spawned; it renders before that message. */
			anchor: number;
			entries: Array<{ kind: 'message' | 'thought' | 'tool'; text: string }>;
		}
	>;
	toolCalls?: Map<string, ToolCall>;
	availableCommands?: AvailableCommand[];
	isDocumentAddedToContext?: boolean;
	attachedDocumentPath?: string; // Path of the document attached to this session
	/** Additional vault paths (files or folders) added to the context. */
	attachedContextPaths?: string[];
	kiroMetadata?: any; // Kiro metadata usage information
	/** Stable persisted record ID — set after the first successful disk save. */
	persistedId?: string;
	/** Whether the session is currently restoring/loading history from disk. */
	isRestoring?: boolean;
	/** Optional generated title for the session. */
	title?: string;
	/** The session's working directory / vault path. */
	cwd?: string;
}

/**
 * Session Manager Implementation
 * Handles ACP session lifecycle and conversation management
 */
export class SessionManagerImpl implements SessionManager {
	private sessions: Map<string, SessionContext> = new Map();
	/** Updates that arrive before the session/new response (e.g. V3 commands); replayed once the session exists. */
	private earlyUpdates: Map<string, any[]> = new Map();
	private options: SessionManagerOptions;
	private cleanupInterval: NodeJS.Timeout | null = null;
	private pendingTimeouts: Set<NodeJS.Timeout> = new Set();

	constructor(options: SessionManagerOptions = {}) {
		this.options = {
			defaultTimeout: 600000,
			maxSessions: 10,
			sessionTimeout: 3600000, // 1 hour
			...options,
		};

		// Set up periodic cleanup
		this.cleanupInterval = setInterval(
			() => this.cleanupExpiredSessions(),
			60000
		); // Check every minute
	}

	/**
	 * Create a new session with optional capabilities
	 */
	async createSession(
		agentId: string,
		jsonRpcClient: JsonRpcClient,
		cwd?: string,
		mcpServers?: SessionNewParams['mcpServers']
	): Promise<{ sessionId: string }> {
		// Check session limit
		if (this.sessions.size >= (this.options.maxSessions || 10)) {
			throw new JsonRpcError(
				JsonRpcErrorCode.INTERNAL_ERROR,
				'Maximum number of sessions reached'
			);
		}

		if (!jsonRpcClient) {
			throw new JsonRpcError(
				JsonRpcErrorCode.INTERNAL_ERROR,
				`No JSON-RPC client provided for session creation`
			);
		}

		// Send session/new request to agent first to get the session ID
		try {
			const params: SessionNewParams = {
				cwd: cwd || process.cwd(),
				mcpServers: mcpServers || [],
			};
			const result = await jsonRpcClient.sendRequest('session/new', params);

			if (!result || !result.sessionId) {
				throw new JsonRpcError(
					JsonRpcErrorCode.INTERNAL_ERROR,
					'Agent did not return a session ID'
				);
			}

			// Create session context using the agent's session ID
			const sessionContext: SessionContext = {
				sessionId: result.sessionId, // Use the agent's session ID
				agentId,
				jsonRpcClient,
				capabilities: [],
				messages: [],
				createdAt: new Date(),
				lastActivity: new Date(),
				status: 'active',
				pendingOperations: new Set(),
				modes: result.modes,
				models: result.models,
				toolCalls: new Map(),
				cwd: cwd || process.cwd(),
				...this.stateFromConfigOptions(result),
			};

			// Store session using the agent's session ID
			this.sessions.set(result.sessionId, sessionContext);
			this.flushEarlyUpdates(result.sessionId);

			return { sessionId: result.sessionId };
		} catch (error) {
			throw new JsonRpcError(
				JsonRpcErrorCode.INTERNAL_ERROR,
				`Failed to create session with agent: ${error.message || 'Unknown error'}`
			);
		}
	}

	/**
	 * Send a prompt to the agent and get a response
	 */
	async sendPrompt(
		sessionId: string,
		messages: Message[]
	): Promise<PromptResult> {
		const session = this.getSession(sessionId);
		const isNewSession =
			!session.title && !session.messages.some((m) => m.role === 'user');

		if (!session.jsonRpcClient) {
			throw new JsonRpcError(
				JsonRpcErrorCode.INTERNAL_ERROR,
				'No JSON-RPC client configured for session'
			);
		}

		// Update session activity
		session.lastActivity = new Date();

		// Add messages to session context
		session.messages.push(...messages);

		// Generate operation ID for tracking
		const operationId = this.generateOperationId();
		session.pendingOperations.add(operationId);

		try {
			// Convert messages to prompt format (flatten all content blocks)
			const promptContent: ContentBlock[] = [];
			for (const message of messages) {
				promptContent.push(...message.content);
			}

			// Send prompt to agent
			const params: SessionPromptParams = {
				sessionId,
				prompt: promptContent,
			};
			const result = await session.jsonRpcClient.sendRequest(
				'session/prompt',
				params,
				0 // No timeout — wait indefinitely for user approval
			);
			// Add agent response to session context
			if (result && result.message) {
				const lastMsg = session.messages[session.messages.length - 1];
				if (lastMsg && lastMsg.role === 'assistant') {
					// Replace accumulated streaming message with final result
					session.messages[session.messages.length - 1] = result.message;
				} else {
					session.messages.push(result.message);
				}
			}

			// Remove operation from pending
			session.pendingOperations.delete(operationId);

			// Persist session after turn completes
			await this.persistSession(session);

			if (isNewSession) {
				const firstUserMsg = session.messages.find((m) => m.role === 'user');
				if (firstUserMsg) {
					this.generateAndSetTitle(session, firstUserMsg).catch((err) => {
						console.warn(
							'Failed to generate title for session in background:',
							err
						);
					});
				}
			}

			return result as PromptResult;
		} catch (error) {
			// Remove operation from pending
			session.pendingOperations.delete(operationId);

			// Map errors appropriately
			if (error instanceof JsonRpcError) {
				throw error;
			}

			throw new JsonRpcError(
				JsonRpcErrorCode.INTERNAL_ERROR,
				`Failed to send prompt: ${error.message || 'Unknown error'}`
			);
		}
	}

	/**
	 * Cancel a session and all its pending operations
	 */
	async cancelSession(sessionId: string): Promise<void> {
		const session = this.getSession(sessionId);

		// Mark session as cancelled
		session.status = 'cancelled';
		session.lastActivity = new Date();

		// If we have pending operations and a JSON-RPC client, notify the agent
		if (session.pendingOperations.size > 0 && session.jsonRpcClient) {
			try {
				const params: SessionCancelParams = { sessionId };
				session.jsonRpcClient.sendNotification('session/cancel', params);

				// Also cancel the pending session/prompt request for this session with a 2-second fallback timeout
				session.jsonRpcClient.cancelRequests(
					(req) =>
						req.method === 'session/prompt' &&
						req.params?.sessionId === sessionId,
					2000
				);
			} catch (error) {
				console.warn(
					'Failed to notify agent about session cancellation:',
					error
				);
			}
		}

		// Clear pending operations
		session.pendingOperations.clear();

		// Persist final state
		await this.persistSession(session);
	}

	/**
	 * Update session with status or message updates
	 */
	updateSession(sessionId: string, update: SessionUpdate): void {
		const session = this.sessions.get(sessionId);

		if (!session) {
			console.warn(`Received update for unknown session: ${sessionId}`);
			return;
		}

		// Update session activity
		session.lastActivity = new Date();

		// Handle different update types
		switch (update.type) {
			case 'message':
				if (update.data && update.data.message) {
					session.messages.push(update.data.message);
				}
				break;

			case 'status':
				if (update.data && update.data.status) {
					session.status = update.data.status;
				}
				break;

			case 'error':
				console.error(`Session ${sessionId} error:`, update.data);
				break;

			default:
				console.warn(`Unknown session update type: ${update.type}`);
		}
	}

	private flushEarlyUpdates(sessionId: string): void {
		const buffered = this.earlyUpdates.get(sessionId);
		if (!buffered) return;
		this.earlyUpdates.delete(sessionId);
		for (const params of buffered) this.handleStreamingUpdate(params);
	}

	/**
	 * Handle streaming updates from session/update notifications
	 */
	handleStreamingUpdate(params: any): void {
		if (!params || !params.sessionId) {
			console.warn('Received session update without sessionId:', params);
			return;
		}

		const { sessionId, update } = params;
		const session = this.sessions.get(sessionId);

		if (!session) {
			const buffered = this.earlyUpdates.get(sessionId) ?? [];
			if (buffered.length < 500) buffered.push(params);
			this.earlyUpdates.set(sessionId, buffered);
			// Bound memory if the session never materializes
			if (this.earlyUpdates.size > 20) {
				this.earlyUpdates.delete(this.earlyUpdates.keys().next().value!);
			}
			return;
		}

		// Ignore updates for cancelled sessions
		if (session.status === 'cancelled') {
			console.debug(
				`Ignoring streaming update for cancelled session: ${sessionId}`
			);
			return;
		}

		// Update session activity
		session.lastActivity = new Date();

		// If we are currently restoring, ignore replayed history notifications.
		// The fully-hydrated messages and tool calls are already loaded from disk.
		if (session.isRestoring) {
			return;
		}

		// CLI V3 runs subagents inside the parent session, tagging their updates with agentSubtaskId.
		const taskId = update?._meta?.kiro?.agentSubtaskId;
		if (taskId) {
			const su = update.sessionUpdate;
			if (
				(su === 'agent_thought_chunk' || su === 'agent_message_chunk') &&
				update.content?.type === 'text' &&
				update.content.text
			) {
				this.notifySpawned(sessionId, {
					type: 'spawned',
					taskId,
					kind: su === 'agent_thought_chunk' ? 'thought' : 'message',
					text: update.content.text,
				});
			} else if (
				(su === 'tool_call' || su === 'tool_call_update') &&
				update._meta.kiro.kind === 'agent-subtask'
			) {
				this.notifySpawned(sessionId, {
					type: 'spawned_status',
					taskId,
					name: update.title?.replace(/^Sub-agent:\s*/, ''),
					status: update.status,
				});
			} else if (su === 'tool_call' && update.title) {
				this.notifySpawned(sessionId, {
					type: 'spawned',
					taskId,
					kind: 'tool',
					text: update.title,
				});
			}
			return;
		}
		// Handle agent_message_chunk for streaming responses
		if (
			update &&
			update.sessionUpdate === 'agent_message_chunk' &&
			update.content
		) {
			// Accumulate in session history
			let lastMsg = session.messages[session.messages.length - 1];
			if (!lastMsg || lastMsg.role !== 'assistant') {
				lastMsg = { role: 'assistant', content: [] };
				session.messages.push(lastMsg);
			}

			// Append chunk to the last assistant message
			if (update.content.type === 'text' && update.content.text) {
				const lastBlock = lastMsg.content[lastMsg.content.length - 1];
				if (lastBlock && lastBlock.type === 'text') {
					lastBlock.text += update.content.text;
				} else {
					lastMsg.content.push({ type: 'text', text: update.content.text });
				}
			} else {
				lastMsg.content.push(update.content);
			}

			// Forward the chunk to the UI callback if available.
			// sessionId is always passed as the first argument so ChatView can
			// compare it against its active session and discard stale chunks.
			// Requirements 3.5, 3.7 — no structural change needed here.
			if (this.options.onStreamingChunk) {
				this.options.onStreamingChunk(sessionId, update.content);
			}

			console.debug('Received streaming chunk (accumulated)');
		} else if (
			update &&
			update.sessionUpdate === 'agent_thought_chunk' &&
			update.content?.type === 'text' &&
			update.content.text
		) {
			if (this.options.onStreamingChunk) {
				this.options.onStreamingChunk(sessionId, {
					type: 'thought',
					text: update.content.text,
				});
			}
		} else if (update && update.sessionUpdate === 'current_mode_update') {
			// Handle mode update
			if (session.modes) {
				session.modes.currentModeId = update.modeId;
			} else {
				session.modes = {
					currentModeId: update.modeId,
					availableModes: [],
				};
			}
			console.debug('Received mode update:', {
				sessionId,
				modeId: update.modeId,
			});
			// Optionally notify the UI about mode update
			if (this.options.onStreamingChunk) {
				this.options.onStreamingChunk(sessionId, {
					type: 'mode',
					modeId: update.modeId,
				});
			}
		} else if (update && update.sessionUpdate === 'tool_call') {
			console.log('Received tool_call:', update);
			// Create new tool call
			if (!session.toolCalls) {
				session.toolCalls = new Map();
			}
			const toolCall: ToolCall = {
				toolCallId: update.toolCallId,
				title: update.title,
				kind: update.kind,
				status: update.status || 'pending',
				content: update.content,
				locations: update.locations,
				rawInput: update.rawInput,
				rawOutput: update.rawOutput,
			};
			session.toolCalls.set(update.toolCallId, toolCall);

			// Add to session messages history as a special system message
			const toolCallMsg: Message = {
				role: 'system',
				content: [
					{
						type: 'tool_call',
						toolCall: toolCall,
					} as any,
				],
			};
			session.messages.push(toolCallMsg);

			// Notify UI
			if (this.options.onStreamingChunk) {
				this.options.onStreamingChunk(sessionId, {
					type: 'tool_call',
					...toolCall,
				});
			}
			console.debug('Received tool_call:', update.toolCallId);
		} else if (update && update.sessionUpdate === 'tool_call_update') {
			console.log('Received tool_call_update:', update);
			// Update existing tool call
			if (session.toolCalls && session.toolCalls.has(update.toolCallId)) {
				const existingCall = session.toolCalls.get(update.toolCallId)!;
				// Merge updates
				if (update.title !== undefined) existingCall.title = update.title;
				if (update.kind !== undefined) existingCall.kind = update.kind;
				if (update.status !== undefined) existingCall.status = update.status;
				if (update.content !== undefined) {
					existingCall.content = existingCall.content || [];
					existingCall.content.push(...update.content);
				}
				if (update.locations !== undefined)
					existingCall.locations = update.locations;
				if (update.rawInput !== undefined)
					existingCall.rawInput = update.rawInput;
				// Also update the tool call block in the messages array
				const toolMsg = session.messages.find(
					(m) =>
						m.role === 'system' &&
						m.content.some(
							(b) =>
								b.type === 'tool_call' &&
								b.toolCall?.toolCallId === update.toolCallId
						)
				);
				if (toolMsg) {
					const block = toolMsg.content.find(
						(b) =>
							b.type === 'tool_call' &&
							b.toolCall?.toolCallId === update.toolCallId
					);
					if (block && block.toolCall) {
						const tc = block.toolCall;
						if (update.title !== undefined) tc.title = update.title;
						if (update.kind !== undefined) tc.kind = update.kind;
						if (update.status !== undefined) tc.status = update.status;
						if (update.content !== undefined) {
							tc.content = tc.content || [];
							tc.content.push(...update.content);
						}
						if (update.locations !== undefined) tc.locations = update.locations;
						if (update.rawInput !== undefined) tc.rawInput = update.rawInput;
						if (update.rawOutput !== undefined) tc.rawOutput = update.rawOutput;
					}
				}

				// Notify UI
				if (this.options.onStreamingChunk) {
					this.options.onStreamingChunk(sessionId, {
						type: 'tool_call_update',
						...existingCall,
						// Include the incremental update content if it exists
						updateContent: update.content,
					});
				}
				console.debug('Received tool_call_update:', update.toolCallId);
			} else {
				console.warn(
					`Received tool_call_update for unknown tool call: ${update.toolCallId}`
				);
			}
		} else if (update && update.sessionUpdate === 'available_commands_update') {
			console.log('Received available_commands_update:', update);
			// Update session context with available commands
			session.availableCommands = update.availableCommands;

			// Notify UI
			if (this.options.onStreamingChunk) {
				this.options.onStreamingChunk(sessionId, {
					type: 'available_commands_update',
					commands: update.availableCommands,
				});
			}
			console.debug('Received available commands for session:', sessionId);
		} else if (update && update.sessionUpdate === 'config_option_update') {
			const state = this.stateFromConfigOptions({
				sessionId,
				configOptions: update.configOptions,
			});
			Object.assign(session, state);
			if (this.options.onStreamingChunk) {
				this.options.onStreamingChunk(sessionId, {
					type: 'config_options',
					modes: session.modes,
					models: session.models,
				});
			}
		} else if (
			update &&
			update.sessionUpdate === 'session_info_update' &&
			update._meta?.kiro?.kind === 'context_usage'
		) {
			const usage = update._meta.kiro.usagePercentage ?? update.usagePercentage;
			if (usage !== undefined) {
				session.kiroMetadata = {
					...session.kiroMetadata,
					contextUsagePercentage: usage,
				};
				if (this.options.onStreamingChunk) {
					this.options.onStreamingChunk(sessionId, {
						type: 'kiro_metadata',
						metadata: session.kiroMetadata,
					});
				}
			}
		} else if (
			update &&
			update.sessionUpdate === 'session_info_update' &&
			update._meta?.kiro?.kind === 'turn_completion'
		) {
			const kiro = update._meta.kiro;
			session.kiroMetadata = {
				...session.kiroMetadata,
				meteringUsage: (kiro.promptTurnSummaries ?? []).map((s: any) => ({
					unit: s.unit,
					unitPlural: s.unitPlural,
					value: s.usage,
				})),
				turnDurationMs: kiro.elapsedTime,
			};
			if (this.options.onStreamingChunk) {
				this.options.onStreamingChunk(sessionId, {
					type: 'kiro_metadata',
					metadata: session.kiroMetadata,
				});
			}
		} else if (
			update &&
			update.sessionUpdate === 'session_info_update' &&
			update._meta?.kiro?.kind === 'display_error'
		) {
			if (this.options.onStreamingChunk) {
				this.options.onStreamingChunk(sessionId, {
					type: 'display_error',
					message: update._meta.kiro.message,
				});
			}
		} else if (update && update.sessionUpdate === 'session_info_update') {
			// Other V3 lifecycle kinds (focus, turn_start/end, ...) need no handling
			console.debug('session_info_update:', update._meta?.kiro?.kind);
		} else {
			// Handle other types of session updates
			console.log('Received session update:', {
				sessionId,
				update,
			});
		}
	}

	/**
	 * Get session information
	 */
	getSessionInfo(sessionId: string): SessionContext | null {
		return this.sessions.get(sessionId) || null;
	}

	/**
	 * Get all active sessions
	 */
	getActiveSessions(): SessionContext[] {
		return Array.from(this.sessions.values()).filter(
			(s) => s.status === 'active'
		);
	}

	/**
	 * Return a unified list of all known sessions — live (in-memory) and
	 * persisted (on disk) — deduplicated and sorted newest-first.
	 */
	getSessions(): SessionSummary[] {
		const results = new Map<string, SessionSummary>();

		// 1. Live in-memory sessions
		for (const session of this.sessions.values()) {
			const summary = this.sessionToSummary(session, true);
			// Key by persistedId when available so disk records don't duplicate
			const key = session.persistedId ?? session.sessionId;
			results.set(key, summary);
		}

		// 2. Persisted sessions not already represented by a live session
		const persistence = this.options.persistenceService;
		if (persistence) {
			for (const record of persistence.getAllSessions()) {
				if (!results.has(record.id)) {
					results.set(record.id, {
						sessionId: record.id,
						agentId: record.agentId,
						createdAt: new Date(record.createdAt),
						lastActivity: new Date(record.lastActivity),
						messageCount: record.messages.length,
						preview: this.previewFromPersistedMessages(record.messages),
						title: record.title,
						isLive: false,
						isPersisted: true,
						attachedDocumentPath: record.attachedDocumentPath,
						attachedContextPaths: record.attachedContextPaths,
					});
				}
			}
		}

		return Array.from(results.values()).sort(
			(a, b) => b.lastActivity.getTime() - a.lastActivity.getTime()
		);
	}

	/**
	 * Load a session by ID.
	 *
	 * - If the session is already live in memory, returns its sessionId.
	 * - If the session exists only on disk:
	 *   - If the agent advertises `loadSession` capability → calls `session/load`
	 *     with the original agent session ID so the agent restores its own context
	 *     and replays history via `session/update` notifications.
	 *   - Otherwise → calls `session/new` and hydrates the in-memory message
	 *     history client-side (agent has no prior context).
	 */
	async loadSession(
		id: string,
		jsonRpcClient?: JsonRpcClient,
		cwd?: string,
		agentCapabilities?: { loadSession?: boolean }
	): Promise<string> {
		// Already live?
		if (this.sessions.has(id)) {
			return id;
		}

		// Check if a live session has this as its persistedId
		for (const session of this.sessions.values()) {
			if (session.persistedId === id) {
				return session.sessionId;
			}
		}

		// Load from disk
		const persistence = this.options.persistenceService;
		if (!persistence) {
			throw new JsonRpcError(
				JsonRpcErrorCode.INTERNAL_ERROR,
				'Session not found and persistence is not configured'
			);
		}

		const record = persistence.getSession(id);
		if (!record) {
			throw new JsonRpcError(
				JsonRpcErrorCode.SESSION_NOT_FOUND,
				`Persisted session not found: ${id}`
			);
		}

		if (!jsonRpcClient) {
			throw new JsonRpcError(
				JsonRpcErrorCode.INTERNAL_ERROR,
				'A JSON-RPC client is required to restore a persisted session'
			);
		}

		const resolvedCwd = cwd || process.cwd();

		// --- Path A: agent supports session/load ---
		if (agentCapabilities?.loadSession && record.agentSessionId) {
			const loadParams = {
				sessionId: record.agentSessionId,
				cwd: resolvedCwd,
				mcpServers: [],
			};

			// session/load causes the agent to replay history via session/update
			// notifications before responding. Those notifications are routed through
			// handleStreamingUpdate → onStreamingChunk as normal, but we don't want
			// them rendered in the UI during restore (the ChatView will re-render from
			// the in-memory messages array after loadSession returns). We therefore
			// create the session context first so handleStreamingUpdate can accumulate
			// chunks into it, then call session/load.
			const sessionContext: SessionContext = {
				sessionId: record.agentSessionId,
				agentId: record.agentId,
				jsonRpcClient,
				capabilities: [],
				messages: record.messages as Message[],
				createdAt: new Date(record.createdAt),
				lastActivity: new Date(record.lastActivity),
				status: 'active',
				pendingOperations: new Set(),
				toolCalls: new Map(),
				attachedDocumentPath: record.attachedDocumentPath,
				attachedContextPaths: record.attachedContextPaths,
				persistedId: record.id,
				isRestoring: true, // Mark as restoring to ignore replayed updates
				title: record.title,
				cwd: resolvedCwd,
			};
			this.sessions.set(record.agentSessionId, sessionContext);

			// Populate toolCalls map from the loaded messages
			if (sessionContext.toolCalls) {
				for (const msg of sessionContext.messages) {
					if (msg.role === 'system') {
						const block = msg.content.find((b) => b.type === 'tool_call');
						const tc = block?.toolCall;
						if (block && tc) {
							sessionContext.toolCalls.set(tc.toolCallId, tc);
						}
					}
				}
			}

			try {
				await jsonRpcClient.sendRequest('session/load', loadParams);
				// Agent has fully replayed history — session is ready
				sessionContext.isRestoring = false;
				return record.agentSessionId;
			} catch (err) {
				// session/load failed — remove the optimistic context and fall through
				this.sessions.delete(record.agentSessionId);
				console.warn('session/load failed, falling back to session/new:', err);
			}
		}

		// --- Path B: fallback — session/new + client-side hydration ---
		const newParams: SessionNewParams = {
			cwd: resolvedCwd,
			mcpServers: [],
		};
		const result = await jsonRpcClient.sendRequest('session/new', newParams);

		if (!result || !result.sessionId) {
			throw new JsonRpcError(
				JsonRpcErrorCode.INTERNAL_ERROR,
				'Agent did not return a session ID'
			);
		}

		const sessionContext: SessionContext = {
			sessionId: result.sessionId,
			agentId: record.agentId,
			jsonRpcClient,
			capabilities: [],
			messages: record.messages as Message[],
			createdAt: new Date(record.createdAt),
			lastActivity: new Date(record.lastActivity),
			status: 'active',
			pendingOperations: new Set(),
			modes: result.modes,
			models: result.models,
			toolCalls: new Map(),
			attachedDocumentPath: record.attachedDocumentPath,
			attachedContextPaths: record.attachedContextPaths,
			persistedId: record.id,
			title: record.title,
			cwd: resolvedCwd,
			...this.stateFromConfigOptions(result),
		};

		// Populate toolCalls map from the loaded messages
		if (sessionContext.toolCalls) {
			for (const msg of sessionContext.messages) {
				if (msg.role === 'system') {
					const block = msg.content.find((b) => b.type === 'tool_call');
					const tc = block?.toolCall;
					if (block && tc) {
						sessionContext.toolCalls.set(tc.toolCallId, tc);
					}
				}
			}
		}

		this.sessions.set(result.sessionId, sessionContext);
		this.flushEarlyUpdates(result.sessionId);
		return result.sessionId;
	}

	/**
	 * Get session statistics
	 */
	getStats(): {
		totalSessions: number;
		activeSessions: number;
		pendingOperations: number;
	} {
		const activeSessions = this.getActiveSessions();
		const pendingOperations = activeSessions.reduce(
			(total, session) => total + session.pendingOperations.size,
			0
		);

		return {
			totalSessions: this.sessions.size,
			activeSessions: activeSessions.length,
			pendingOperations,
		};
	}

	/**
	 * Clean up expired sessions
	 */
	private cleanupExpiredSessions(): void {
		const now = new Date();
		const timeout = this.options.sessionTimeout || 3600000;

		for (const [sessionId, session] of this.sessions.entries()) {
			const age = now.getTime() - session.lastActivity.getTime();

			if (age > timeout && session.status !== 'active') {
				this.sessions.delete(sessionId);
				console.debug(`Cleaned up expired session: ${sessionId}`);
			}
		}
	}

	/** Store spawned-agent state on the parent session so it survives conversation switches, then notify the UI. */
	private notifySpawned(
		parentId: string,
		chunk: {
			type: 'spawned' | 'spawned_status';
			taskId: string;
			kind?: 'message' | 'thought' | 'tool';
			text?: string;
			name?: string;
			status?: string;
		}
	): void {
		const session = this.sessions.get(parentId);
		if (session) {
			session.spawnedAgents ??= new Map();
			const agent = session.spawnedAgents.get(chunk.taskId) ?? {
				anchor: session.messages.length,
				entries: [],
			};
			if (chunk.name) agent.name = chunk.name;
			if (chunk.status) agent.status = chunk.status;
			if (chunk.kind && chunk.text) {
				const last = agent.entries[agent.entries.length - 1];
				if (last && last.kind === chunk.kind && chunk.kind !== 'tool') {
					last.text += chunk.text;
				} else {
					agent.entries.push({ kind: chunk.kind, text: chunk.text });
				}
			}
			session.spawnedAgents.set(chunk.taskId, agent);
		}
		this.options.onStreamingChunk?.(parentId, chunk);
	}

	/**
	 * Derive modes/models from `configOptions` when the agent doesn't return the legacy fields.
	 */
	private stateFromConfigOptions(
		result: SessionNewResult
	): Pick<
		SessionContext,
		'modes' | 'models' | 'modeConfigId' | 'modelConfigId'
	> {
		const options = (result.configOptions ?? []).filter(
			(o) => o.type === 'select'
		);
		const out: Pick<
			SessionContext,
			'modes' | 'models' | 'modeConfigId' | 'modelConfigId'
		> = {};

		const modeOpt = options.find((o) => o.category === 'mode');
		if (modeOpt) {
			out.modeConfigId = modeOpt.id;
			if (!result.modes) {
				out.modes = {
					currentModeId: modeOpt.currentValue,
					availableModes: modeOpt.options.map((v) => ({
						id: v.value,
						name: v.name,
						description: v.description,
					})),
				};
			}
		}

		const modelOpt = options.find((o) => o.category === 'model');
		if (modelOpt) {
			out.modelConfigId = modelOpt.id;
			if (!result.models) {
				out.models = {
					currentModelId: modelOpt.currentValue,
					availableModels: modelOpt.options.map((v) => ({
						modelId: v.value,
						name: v.name,
						description: v.description ?? '',
					})),
				};
			}
		}
		return out;
	}

	/** Uses session/set_config_option when the agent exposes the setting that way. */
	private async sendModelChange(
		session: SessionContext,
		sessionId: string,
		modelId: string
	): Promise<void> {
		if (session.modelConfigId) {
			await session.jsonRpcClient.sendRequest('session/set_config_option', {
				sessionId,
				configId: session.modelConfigId,
				value: modelId,
			});
		} else {
			const params: SessionSetModelParams = { sessionId, modelId };
			await session.jsonRpcClient.sendRequest('session/set_model', params);
		}
	}

	/**
	 * Set the current mode for a session
	 */
	async setMode(sessionId: string, modeId: string): Promise<void> {
		const session = this.getSession(sessionId);

		if (!session.jsonRpcClient) {
			throw new JsonRpcError(
				JsonRpcErrorCode.INTERNAL_ERROR,
				'No JSON-RPC client configured for session'
			);
		}

		try {
			const params: SessionSetModeParams = {
				sessionId,
				modeId,
			};
			if (session.modeConfigId) {
				await session.jsonRpcClient.sendRequest('session/set_config_option', {
					sessionId,
					configId: session.modeConfigId,
					value: modeId,
				});
			} else {
				await session.jsonRpcClient.sendRequest('session/set_mode', params);
			}

			if (session.modes) {
				session.modes.currentModeId = modeId;
			}

			session.lastActivity = new Date();
		} catch (error) {
			throw new JsonRpcError(
				JsonRpcErrorCode.INTERNAL_ERROR,
				`Failed to set mode: ${error.message || 'Unknown error'}`
			);
		}
	}

	/**
	 * Set the current model for a session
	 */
	async setModel(sessionId: string, modelId: string): Promise<void> {
		const session = this.getSession(sessionId);

		if (!session.jsonRpcClient) {
			throw new JsonRpcError(
				JsonRpcErrorCode.INTERNAL_ERROR,
				'No JSON-RPC client configured for session'
			);
		}

		try {
			await this.sendModelChange(session, sessionId, modelId);

			if (session.models) {
				session.models.currentModelId = modelId;
			}

			session.lastActivity = new Date();
		} catch (error) {
			throw new JsonRpcError(
				JsonRpcErrorCode.INTERNAL_ERROR,
				`Failed to set model: ${error.message || 'Unknown error'}`
			);
		}
	}

	/**
	 * Get session or throw error if not found
	 */
	private getSession(sessionId: string): SessionContext {
		const session = this.sessions.get(sessionId);

		if (!session) {
			throw new JsonRpcError(
				JsonRpcErrorCode.SESSION_NOT_FOUND,
				`Session not found: ${sessionId}`
			);
		}

		if (session.status === 'cancelled') {
			session.status = 'active';
		}

		return session;
	}

	/**
	 * Generate unique operation ID
	 */
	private generateOperationId(): string {
		return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Persist a session to disk if the persistence service is configured.
	 * Updates `session.persistedId` with the stable record ID.
	 */
	private async persistSession(session: SessionContext): Promise<void> {
		const persistence = this.options.persistenceService;
		if (!persistence) return;
		try {
			const id = await persistence.saveSession(
				session,
				session.persistedId ?? undefined
			);
			if (id) session.persistedId = id;
		} catch (err) {
			console.warn('Failed to persist session:', err);
		}
	}

	/**
	 * Build a SessionSummary from a live SessionContext.
	 */
	private sessionToSummary(
		session: SessionContext,
		isLive: boolean
	): SessionSummary {
		const persistence = this.options.persistenceService;
		return {
			sessionId: session.persistedId ?? session.sessionId,
			agentId: session.agentId,
			createdAt: session.createdAt,
			lastActivity: session.lastActivity,
			messageCount: session.messages.length,
			preview: this.previewFromMessages(session.messages),
			title: session.title,
			isLive,
			isPersisted: !!session.persistedId && !!persistence,
			attachedDocumentPath: session.attachedDocumentPath,
			attachedContextPaths: session.attachedContextPaths,
		};
	}

	private previewFromMessages(messages: Message[]): string {
		const first = messages.find((m) => m.role === 'user');
		if (!first) return 'Empty conversation';
		const textBlock = first.content.find((b) => b.type === 'text');
		const text = (textBlock as any)?.text ?? 'Untitled';
		const clean = text.replace(/^Current document: .*\n\n/, '');
		return clean.length > 80 ? clean.substring(0, 80) + '…' : clean;
	}

	private previewFromPersistedMessages(messages: any[]): string {
		const first = messages.find((m: any) => m.role === 'user');
		if (!first) return 'Empty conversation';
		const textBlock = first.content.find((b: any) => b.type === 'text');
		const text = textBlock?.text ?? 'Untitled';
		const clean = text.replace(/^Current document: .*\n\n/, '');
		return clean.length > 80 ? clean.substring(0, 80) + '…' : clean;
	}

	private async generateAndSetTitle(
		session: SessionContext,
		userMessage: Message
	): Promise<void> {
		let initialRequest = '';
		const contexts: string[] = [];

		for (const block of userMessage.content) {
			if (block.type === 'text' && block.text) {
				if (block.text.startsWith('Selected text (')) {
					contexts.push(block.text);
				} else {
					initialRequest = block.text;
				}
			} else if (block.type === 'resource_link') {
				contexts.push(`Active document: ${block.name} (path: ${block.uri})`);
				if (block.text) {
					const cleanText = block.text.replace(/^Current document: .*\n\n/, '');
					if (cleanText && !initialRequest) {
						initialRequest = cleanText;
					}
				}
			}
		}

		if (!initialRequest) {
			initialRequest = 'Untitled conversation';
		}

		const contextStr = contexts.join('\n');

		const title = await this.generateTitleForSession(
			session,
			initialRequest,
			contextStr
		);
		console.log(`[ACP] Generated session title: "${title}"`);

		session.title = title;
		await this.persistSession(session);
	}

	private async generateTitleForSession(
		session: SessionContext,
		initialRequest: string,
		contextInfo?: string
	): Promise<string> {
		if (!session.jsonRpcClient) {
			return 'Untitled';
		}

		try {
			const newParams: SessionNewParams = {
				cwd: session.cwd || process.cwd(),
				mcpServers: [],
			};
			const newResult = await session.jsonRpcClient.sendRequest(
				'session/new',
				newParams
			);
			if (!newResult || !newResult.sessionId) {
				return 'Untitled';
			}
			const tempSessionId = newResult.sessionId;

			const tempSessionContext: SessionContext = {
				sessionId: tempSessionId,
				agentId: session.agentId,
				jsonRpcClient: session.jsonRpcClient,
				capabilities: [],
				messages: [],
				createdAt: new Date(),
				lastActivity: new Date(),
				status: 'active',
				pendingOperations: new Set(),
				toolCalls: new Map(),
			};
			this.sessions.set(tempSessionId, tempSessionContext);

			try {
				if (session.models?.currentModelId) {
					try {
						await this.sendModelChange(
							session,
							tempSessionId,
							session.models.currentModelId
						);
					} catch (modelErr) {
						console.warn('Failed to set model on temporary session:', modelErr);
					}
				}

				let promptText = `Based on the following initial user request and context, generate a short, descriptive title (maximum 6 words) for this conversation. Do not include quotes, markdown formatting, or any extra text. Just return the title.\n\nUser Request: ${initialRequest}`;
				if (contextInfo) {
					promptText += `\n\nContext: ${contextInfo}`;
				}

				const promptParams: SessionPromptParams = {
					sessionId: tempSessionId,
					prompt: [{ type: 'text', text: promptText }],
				};

				const promptResult = await session.jsonRpcClient.sendRequest(
					'session/prompt',
					promptParams
				);

				let title = 'Untitled';
				// 1. Try to get it from the accumulated messages (for streaming-only agents)
				const lastMsg =
					tempSessionContext.messages[tempSessionContext.messages.length - 1];
				if (lastMsg && lastMsg.role === 'assistant') {
					const textBlock = lastMsg.content.find((b) => b.type === 'text');
					if (textBlock && textBlock.text) {
						title = textBlock.text.trim().replace(/^["']|["']$/g, '');
					}
				}
				// 2. Fallback to direct promptResult (for non-streaming agents or mocks)
				if (
					title === 'Untitled' &&
					promptResult &&
					promptResult.message &&
					promptResult.message.content
				) {
					const textBlock = promptResult.message.content.find(
						(b: any) => b.type === 'text'
					);
					if (textBlock && textBlock.text) {
						title = textBlock.text.trim().replace(/^["']|["']$/g, '');
					}
				}
				return title;
			} finally {
				this.sessions.delete(tempSessionId);
				try {
					session.jsonRpcClient.sendNotification('session/cancel', {
						sessionId: tempSessionId,
					});
				} catch (cancelErr) {
					console.warn(
						'Failed to cancel temporary title-generation session:',
						cancelErr
					);
				}
			}
		} catch (err) {
			console.warn('Failed to generate session title via agent:', err);
			return 'Untitled';
		}
	}

	/**
	 * Shutdown the session manager and clean up resources
	 */
	async shutdown(): Promise<void> {
		// Clear cleanup interval
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		// Clear all pending timeouts
		for (const timeout of this.pendingTimeouts) {
			clearTimeout(timeout);
		}
		this.pendingTimeouts.clear();

		// Cancel all active sessions
		for (const sessionId of this.sessions.keys()) {
			try {
				const session = this.sessions.get(sessionId);
				if (session && session.status === 'active') {
					// Persist before shutdown
					await this.persistSession(session);
					// Mark as cancelled without using setTimeout
					session.status = 'cancelled';
					session.pendingOperations.clear();
				}
			} catch (error) {
				console.warn(
					`Error cancelling session ${sessionId} during shutdown:`,
					error
				);
			}
		}

		this.sessions.clear();
	}
}
