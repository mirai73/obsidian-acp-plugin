/**
 * Agent Client Protocol (ACP) Types
 * Based on the ACP specification from https://agentclientprotocol.com/
 */

// Initialization
export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities?: {
    fs?: {
      readTextFile?: boolean;
      writeTextFile?: boolean;
    };
    terminal?: boolean;
  };
  clientInfo?: {
    name: string;
    title?: string;
    version: string;
  };
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: {
      image?: boolean;
      audio?: boolean;
      embeddedContext?: boolean;
    };
    mcp?: {
      http?: boolean;
      sse?: boolean;
    };
  };
  agentInfo?: {
    name: string;
    title?: string;
    version: string;
  };
  authMethods?: string[];
}

// File system operations
export interface FsReadTextFileParams {
  path: string;
}

export interface FsReadTextFileResult {
  content: string;
  encoding?: string;
}

export interface FsWriteTextFileParams {
  path: string;
  content: string;
  encoding?: string;
}

// Session management
export interface SessionNewParams {
  cwd: string;
  mcpServers: Array<{
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
  }>;
}

export interface SessionNewResult {
  sessionId: string;
  modes?: {
    currentModeId: string;
    availableModes: Array<{
      id: string;
      name: string;
      description: string;
    }>;
  };
  models?: {
    currentModelId: string;
    availableModels: Array<{
      modelId: string;
      name: string;
      description: string;
    }>;
  };
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: ContentBlock[];
}

export interface ContentBlock {
  type: "text" | "image" | "resource" | "diff";
  text?: string;
  source?: string;
  data?: string;
  mimeType?: string;
  resource?: {
    uri: string;
    mimeType?: string;
    text?: string;
  };
}

export interface SessionPromptParams {
  sessionId: string;
  prompt: ContentBlock[]; // Array of content blocks
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface PromptResult {
  message: Message;
  stopReason: "end_turn" | "max_tokens" | "stop_sequence" | "cancelled";
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface SessionCancelParams {
  sessionId: string;
}

// Permission system
export interface SessionRequestPermissionParams {
  sessionId: string;
  toolCall?: {
    toolCallId: string;
    title: string;
  };
  options: Array<{
    optionId: string;
    name: string;
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
  }>;
  operation?: string;
  resource?: string;
  reason?: string;
}

export interface SessionRequestPermissionResult {
  outcome: {
    outcome: 'selected' | 'cancelled';
    optionId?: string;
  };
}

// Session updates (notifications)
export interface SessionUpdateParams {
  sessionId: string;
  type: "message" | "status" | "error";
  data: any;
}

export interface SessionUpdate {
  type: "message" | "status" | "error";
  data: any;
}

// Connection status
export interface ConnectionStatus {
  connected: boolean;
  agentName?: string;
  capabilities?: string[];
  error?: string;
  status?: "connected" | "disconnected" | "connecting" | "error";
  lastConnected?: Date;
}