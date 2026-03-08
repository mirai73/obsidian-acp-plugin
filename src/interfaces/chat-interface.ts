/**
 * Chat Interface Component Interface
 * Defines the contract for the user interface components
 */

import { Message, ConnectionStatus } from '../types/acp';

export interface ChatInterface {
  displayMessage(message: Message): void;
  getUserInput(): Promise<string>;
  showConnectionStatus(status: ConnectionStatus): void;
  renderMarkdown(content: string): HTMLElement;
  setMode(modeId: string): Promise<void>;
}