/**
 * Obsidian Integration Interface
 * Defines the contract for integrating with Obsidian's file system and UI
 */

export interface ObsidianFileNotifier {
  /**
   * Notify Obsidian that a file has been created
   */
  notifyFileCreated(path: string): void;

  /**
   * Notify Obsidian that a file has been modified
   */
  notifyFileModified(path: string): void;

  /**
   * Notify Obsidian that a file has been deleted
   */
  notifyFileDeleted(path: string): void;
}

export interface ObsidianVaultAdapter {
  /**
   * Get the vault root path
   */
  getVaultPath(): string;

  /**
   * Check if a path exists in the vault
   */
  pathExists(path: string): Promise<boolean>;

  /**
   * Get file metadata
   */
  getFileMetadata(path: string): Promise<{
    size: number;
    mtime: Date;
    ctime: Date;
  }>;

  /**
   * Trigger vault refresh for a path
   */
  refreshPath(path: string): void;
}

export interface ObsidianIntegration extends ObsidianFileNotifier, ObsidianVaultAdapter {
  /**
   * Check if running in Obsidian environment
   */
  isObsidianEnvironment(): boolean;

  /**
   * Get Obsidian app instance (if available)
   */
  getApp(): any;
}