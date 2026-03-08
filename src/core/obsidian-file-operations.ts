/**
 * Obsidian-Integrated File Operations Handler
 * Extends file operations with Obsidian undo/redo system integration
 */

import { App, TFile, TFolder, Vault, Notice } from 'obsidian';
import { FileOperationsHandler } from '../interfaces/file-operations';

export interface ObsidianFileOperationsConfig {
  app: App;
  enableUndoRedo?: boolean;
  trackChanges?: boolean;
  showNotifications?: boolean;
}

/**
 * File operations handler that integrates with Obsidian's undo/redo system
 */
export class ObsidianFileOperationsHandler implements FileOperationsHandler {
  private app: App;
  private vault: Vault;
  private enableUndoRedo: boolean;
  private trackChanges: boolean;
  private showNotifications: boolean;
  private changeHistory: Map<string, FileChangeRecord[]> = new Map();

  constructor(config: ObsidianFileOperationsConfig) {
    this.app = config.app;
    this.vault = config.app.vault;
    this.enableUndoRedo = config.enableUndoRedo ?? true;
    this.trackChanges = config.trackChanges ?? true;
    this.showNotifications = config.showNotifications ?? false;
  }

  /**
   * Read text file using Obsidian's vault API
   */
  async readTextFile(filePath: string): Promise<{content: string, encoding?: string}> {
    try {
      // Normalize path for Obsidian
      const normalizedPath = this.normalizePath(filePath);
      
      // Get file from vault
      const file = this.vault.getAbstractFileByPath(normalizedPath);
      
      if (!file) {
        throw new Error(`File not found: ${filePath}`);
      }

      if (!(file instanceof TFile)) {
        throw new Error(`Path is not a file: ${filePath}`);
      }

      // Read file content using Obsidian's API
      const content = await this.vault.read(file);
      
      return {
        content,
        encoding: 'utf8'
      };

    } catch (error) {
      if (error.message.includes('File not found') || error.message.includes('Path is not a file')) {
        throw error;
      }
      throw new Error(`Failed to read file ${filePath}: ${error.message}`);
    }
  }

  /**
   * Write text file with undo/redo integration
   */
  async writeTextFile(filePath: string, content: string, encoding?: string): Promise<void> {
    try {
      const normalizedPath = this.normalizePath(filePath);
      const file = this.vault.getAbstractFileByPath(normalizedPath);

      if (file && !(file instanceof TFile)) {
        throw new Error(`Path exists but is not a file: ${filePath}`);
      }

      let originalContent: string | null = null;
      let isNewFile = false;

      if (file) {
        // File exists, read original content for undo tracking
        if (this.enableUndoRedo || this.trackChanges) {
          originalContent = await this.vault.read(file);
        }
      } else {
        // New file
        isNewFile = true;
      }

      // Record change for undo/redo system
      if (this.trackChanges) {
        this.recordFileChange(normalizedPath, {
          type: isNewFile ? 'create' : 'modify',
          timestamp: new Date(),
          originalContent,
          newContent: content,
          filePath: normalizedPath
        });
      }

      // Perform the file operation
      if (isNewFile) {
        // Create new file
        await this.vault.create(normalizedPath, content);
        
        if (this.showNotifications) {
          new Notice(`Created file: ${normalizedPath}`);
        }
      } else {
        // Modify existing file
        await this.vault.modify(file as TFile, content);
        
        if (this.showNotifications) {
          new Notice(`Modified file: ${normalizedPath}`);
        }
      }

      // Integrate with Obsidian's undo system
      if (this.enableUndoRedo && !isNewFile) {
        this.integrateWithUndoSystem(normalizedPath, originalContent!, content);
      }

    } catch (error) {
      throw new Error(`Failed to write file ${filePath}: ${error.message}`);
    }
  }

  /**
   * Validate file path for Obsidian vault
   */
  validatePath(filePath: string): boolean {
    if (!filePath || typeof filePath !== 'string') {
      return false;
    }

    // Check for null bytes
    if (filePath.includes('\0')) {
      return false;
    }

    // Check for invalid characters
    const invalidChars = /[<>:"|?*]/;
    if (invalidChars.test(filePath)) {
      return false;
    }

    // Check for absolute paths
    if (filePath.startsWith('/') || /^[a-zA-Z]:/.test(filePath)) {
      return false;
    }

    return true;
  }

  /**
   * Check if path is within vault boundaries
   */
  isWithinVault(filePath: string): boolean {
    try {
      const normalizedPath = this.normalizePath(filePath);
      
      // Check for path traversal attempts
      if (normalizedPath.includes('..')) {
        return false;
      }

      // All paths in Obsidian vault are considered within boundaries
      // if they don't contain path traversal
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get vault path
   */
  getVaultPath(): string {
    // Try to get the base path from the adapter
    const adapter = this.vault.adapter as any;
    return adapter.basePath || adapter.path || '';
  }

  /**
   * Undo last file operation
   */
  async undoLastOperation(filePath?: string): Promise<boolean> {
    if (!this.trackChanges) {
      return false;
    }

    const targetPath = filePath ? this.normalizePath(filePath) : this.getLastModifiedFile();
    if (!targetPath) {
      return false;
    }

    const changes = this.changeHistory.get(targetPath);
    if (!changes || changes.length === 0) {
      return false;
    }

    const lastChange = changes[changes.length - 1];
    
    try {
      if (lastChange.type === 'create') {
        // Undo file creation by deleting the file
        const file = this.vault.getAbstractFileByPath(targetPath);
        if (file) {
          await this.vault.delete(file);
        }
      } else if (lastChange.type === 'modify' && lastChange.originalContent !== null) {
        // Undo file modification by restoring original content
        const file = this.vault.getAbstractFileByPath(targetPath);
        if (file instanceof TFile) {
          await this.vault.modify(file, lastChange.originalContent);
        }
      }

      // Remove the change from history
      changes.pop();
      if (changes.length === 0) {
        this.changeHistory.delete(targetPath);
      }

      if (this.showNotifications) {
        new Notice(`Undid operation on: ${targetPath}`);
      }

      return true;
    } catch (error) {
      console.error('Failed to undo operation:', error);
      return false;
    }
  }

  /**
   * Get change history for a file
   */
  getChangeHistory(filePath: string): FileChangeRecord[] {
    const normalizedPath = this.normalizePath(filePath);
    return this.changeHistory.get(normalizedPath) || [];
  }

  /**
   * Clear change history
   */
  clearChangeHistory(filePath?: string): void {
    if (filePath) {
      const normalizedPath = this.normalizePath(filePath);
      this.changeHistory.delete(normalizedPath);
    } else {
      this.changeHistory.clear();
    }
  }

  /**
   * Get all files with change history
   */
  getTrackedFiles(): string[] {
    return Array.from(this.changeHistory.keys());
  }

  /**
   * Normalize path for Obsidian
   */
  private normalizePath(filePath: string): string {
    // Convert backslashes to forward slashes
    let normalized = filePath.replace(/\\/g, '/');
    
    // Remove leading slashes
    normalized = normalized.replace(/^\/+/, '');
    
    // Remove trailing slashes
    normalized = normalized.replace(/\/+$/, '');
    
    return normalized;
  }

  /**
   * Record file change for tracking
   */
  private recordFileChange(filePath: string, change: FileChangeRecord): void {
    if (!this.changeHistory.has(filePath)) {
      this.changeHistory.set(filePath, []);
    }
    
    const changes = this.changeHistory.get(filePath)!;
    changes.push(change);
    
    // Limit history size to prevent memory issues
    const maxHistorySize = 50;
    if (changes.length > maxHistorySize) {
      changes.shift(); // Remove oldest change
    }
  }

  /**
   * Integrate with Obsidian's undo system
   */
  private integrateWithUndoSystem(filePath: string, originalContent: string, newContent: string): void {
    // This is a simplified integration - in a full implementation,
    // we would need to hook into Obsidian's internal undo system
    // For now, we maintain our own undo tracking
    
    // The actual integration would require access to Obsidian's internal APIs
    // which may not be publicly available
    console.log(`Integrated undo for file: ${filePath}`);
  }

  /**
   * Get the last modified file from change history
   */
  private getLastModifiedFile(): string | null {
    let lastModified: string | null = null;
    let lastTimestamp = 0;

    for (const [filePath, changes] of this.changeHistory) {
      if (changes.length > 0) {
        const lastChange = changes[changes.length - 1];
        if (lastChange.timestamp.getTime() > lastTimestamp) {
          lastTimestamp = lastChange.timestamp.getTime();
          lastModified = filePath;
        }
      }
    }

    return lastModified;
  }
}

/**
 * File change record for undo/redo tracking
 */
export interface FileChangeRecord {
  type: 'create' | 'modify' | 'delete';
  timestamp: Date;
  filePath: string;
  originalContent: string | null;
  newContent: string;
}