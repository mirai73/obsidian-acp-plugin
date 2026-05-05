/**
 * Plugin Configuration and Settings Types
 */

/**
 * A single persisted message block (subset of ContentBlock, serialisable).
 */
export interface PersistedContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  source?: string;
  uri?: string;
  name?: string;
  size?: number;
}

/**
 * A single persisted message (role + content blocks).
 */
export interface PersistedMessage {
  role: 'user' | 'assistant' | 'system';
  content: PersistedContentBlock[];
}

/**
 * A persisted session record stored in plugin data.
 */
export interface PersistedSession {
  /** Unique identifier for this persisted record (not the live agent session ID). */
  id: string;
  /** The agent ID this session belongs to. */
  agentId: string;
  /** The original agent-assigned session ID — used for `session/load` when the
   *  agent supports the `loadSession` capability. */
  agentSessionId: string;
  /** ISO-8601 timestamp of when the session was created. */
  createdAt: string;
  /** ISO-8601 timestamp of the last message activity. */
  lastActivity: string;
  /** Conversation messages (client-side copy for agents that don't support loadSession). */
  messages: PersistedMessage[];
  /** Optional path of the document attached to this session. */
  attachedDocumentPath?: string;
}

export interface PluginSettings {
  agents: AgentConfig[];
  defaultAgentId: string | null;
  permissions: PermissionConfig;
  ui: UIConfig;
  connection: ConnectionConfig;
  sessions: SessionPersistenceConfig;
  persistedSessions: PersistedSession[];
}

export interface SessionPersistenceConfig {
  /** Master toggle — when false sessions are never written to or read from disk. */
  enabled: boolean;
  /** Whether to automatically delete sessions older than `cleanupAfterDays`. */
  autoCleanup: boolean;
  /** Number of days after which sessions are automatically deleted (default 30). */
  cleanupAfterDays: number;
}

export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  enabled: boolean;
}

export interface PermissionConfig {
  allowedPaths: string[];
  deniedPaths: string[];
  readOnlyPaths: string[];
  requireConfirmation: boolean;
  logOperations: boolean;
  showPermissionDialog: boolean;
}

export interface UIConfig {
  theme: 'light' | 'dark' | 'auto';
  showTimestamps: boolean;
  enableMarkdown: boolean;
  showFileOperationNotifications: boolean;
  respectSystemTheme: boolean;
  customColors?: {
    primary?: string;
    success?: string;
    error?: string;
    warning?: string;
  };
}

export interface ConnectionConfig {
  autoReconnect: boolean;
  reconnectInterval: number; // seconds
  maxReconnectAttempts: number;
  connectionTimeout: number; // seconds
}

export const DEFAULT_SETTINGS: Partial<PluginSettings> = {
  agents: [],
  defaultAgentId: null,
  permissions: {
    allowedPaths: [],
    deniedPaths: [],
    readOnlyPaths: [],
    requireConfirmation: true,
    logOperations: true,
    showPermissionDialog: true,
  },
  ui: {
    theme: 'auto',
    showTimestamps: true,
    enableMarkdown: true,
    showFileOperationNotifications: false,
    respectSystemTheme: true,
  },
  connection: {
    autoReconnect: true,
    reconnectInterval: 30,
    maxReconnectAttempts: 3,
    connectionTimeout: 10,
  },
  sessions: {
    enabled: true,
    autoCleanup: true,
    cleanupAfterDays: 30,
  },
  persistedSessions: [],
};

export const ExtensionToMime: Record<string, string> = {
  md: 'text/markdown',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
};
