/**
 * Plugin Configuration and Settings Types
 */

export interface PluginSettings {
  agents: AgentConfig[];
  permissions: PermissionConfig;
  ui: UIConfig;
  connection: ConnectionConfig;
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
  theme: "light" | "dark" | "auto";
  fontSize: number;
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
  permissions: {
    allowedPaths: [],
    deniedPaths: [],
    readOnlyPaths: [],
    requireConfirmation: true,
    logOperations: true,
    showPermissionDialog: true,
  },
  ui: {
    theme: "auto",
    fontSize: 14,
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
};