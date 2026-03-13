/**
 * File Operations Handler Implementation
 * Handles file system operations within vault boundaries with security enforcement
 * Enhanced with comprehensive error handling and audit logging
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { FileOperationsHandler } from '../interfaces/file-operations';
import { ObsidianFileNotifier } from '../interfaces/obsidian-integration';
import { errorHandler, ErrorCategory, ACPErrorCode } from './error-handler';
import { logger, LogCategory } from './logging-system';

export interface FileOperationsConfig {
	vaultPath: string;
	allowedExtensions?: string[];
	maxFileSize?: number;
	createDirectories?: boolean;
	obsidianNotifier?: ObsidianFileNotifier;
	sessionId?: string;
	userId?: string;
}

/**
 * Implementation of file operations with vault boundary enforcement
 * Enhanced with comprehensive error handling and audit logging
 */
export class FileOperationsHandlerImpl implements FileOperationsHandler {
	private vaultPath: string;
	private allowedExtensions: Set<string>;
	private maxFileSize: number;
	private createDirectories: boolean;
	private obsidianNotifier?: ObsidianFileNotifier;
	private sessionId?: string;
	private userId?: string;

	constructor(config: FileOperationsConfig) {
		this.vaultPath = path.resolve(config.vaultPath);
		this.allowedExtensions = new Set(
			config.allowedExtensions || ['.md', '.txt', '.json']
		);
		this.maxFileSize = config.maxFileSize || 10 * 1024 * 1024; // 10MB default
		this.createDirectories = config.createDirectories ?? true;
		this.obsidianNotifier = config.obsidianNotifier;
		this.sessionId = config.sessionId;
		this.userId = config.userId;

		logger.info(LogCategory.FILE_OPS, 'File operations handler initialized', {
			vaultPath: this.vaultPath,
			allowedExtensions: Array.from(this.allowedExtensions),
			maxFileSize: this.maxFileSize,
			sessionId: this.sessionId,
		});
	}

	/**
	 * Read text file contents with vault boundary checks
	 * Enhanced with comprehensive error handling and audit logging
	 */
	async readTextFile(
		filePath: string
	): Promise<{ content: string; encoding?: string }> {
		logger.debug(LogCategory.FILE_OPS, 'Reading file', {
			filePath,
			sessionId: this.sessionId,
		});

		try {
			// Validate and normalize path
			const normalizedPath = this.normalizePath(filePath);

			if (!this.validatePath(normalizedPath)) {
				const error = errorHandler.createInvalidPathError(
					filePath,
					'Invalid path format'
				);
				// logger.fileOp('read', filePath, false, new Error(error.message), this.sessionId, this.userId);
				throw new Error(error.message);
			}

			if (!this.isWithinVault(normalizedPath)) {
				const error = errorHandler.createVaultBoundaryViolationError(filePath);
				// logger.fileOp('read', filePath, false, new Error(error.message), this.sessionId, this.userId);
				throw new Error(error.message);
			}

			const absolutePath = this.resolveAbsolutePath(normalizedPath);

			// Check if file exists
			const stats = await fs.stat(absolutePath);

			if (!stats.isFile()) {
				const error = errorHandler.createInvalidPathError(
					filePath,
					'Path is not a file'
				);
				// logger.fileOp('read', filePath, false, new Error(error.message), this.sessionId, this.userId);
				throw new Error(error.message);
			}

			// Check file size
			if (stats.size > this.maxFileSize) {
				const error = errorHandler.createJsonRpcError(
					ACPErrorCode.FILE_OPERATION_FAILED,
					`File too large: ${filePath} (${stats.size} bytes, max ${this.maxFileSize})`,
					{ fileSize: stats.size, maxSize: this.maxFileSize }
				);
				// logger.fileOp('read', filePath, false, new Error(error.message), this.sessionId, this.userId);
				throw new Error(error.message);
			}

			// Check file extension
			const ext = path.extname(absolutePath).toLowerCase();
			if (this.allowedExtensions.size > 0 && !this.allowedExtensions.has(ext)) {
				const error = errorHandler.createPermissionDeniedError(
					'read',
					filePath
				);
				// logger.fileOp('read', filePath, false, new Error(error.message), this.sessionId, this.userId);
				throw new Error(error.message);
			}

			// Read file content
			const content = await fs.readFile(absolutePath, 'utf8');

			// Log successful operation
			// logger.fileOp('read', filePath, true, undefined, this.sessionId, this.userId);

			logger.debug(LogCategory.FILE_OPS, 'File read successfully', {
				filePath,
				contentLength: content.length,
				sessionId: this.sessionId,
			});

			return {
				content,
				encoding: 'utf8',
			};
		} catch (error) {
			// Handle specific error types with enhanced error reporting
			const nodeError = error as NodeJS.ErrnoException;

			if (nodeError.code === 'ENOENT') {
				const enhancedError = errorHandler.createFileNotFoundError(filePath);
				// logger.fileOp('read', filePath, false, error as Error, this.sessionId, this.userId);
				throw new Error(enhancedError.message);
			}

			if (nodeError.code === 'EACCES') {
				const enhancedError = errorHandler.createPermissionDeniedError(
					'read',
					filePath
				);
				// logger.fileOp('read', filePath, false, error as Error, this.sessionId, this.userId);
				throw new Error(enhancedError.message);
			}

			// If it's already one of our custom errors, re-throw as is
			if (
				(error as Error).message.includes('Invalid path') ||
				(error as Error).message.includes('outside vault boundaries') ||
				(error as Error).message.includes('File type not allowed') ||
				(error as Error).message.includes('File too large') ||
				(error as Error).message.includes('Path is not a file')
			) {
				throw error;
			}

			// Handle unexpected errors
			const errorInfo = errorHandler.handleError(
				error as Error,
				ErrorCategory.FILE_SYSTEM,
				{
					operation: 'read',
					filePath,
					sessionId: this.sessionId,
				}
			);

			// logger.fileOp('read', filePath, false, error as Error, this.sessionId, this.userId);
			throw error;
		}
	}

	/**
	 * Write text file with directory creation and vault boundary checks
	 * Enhanced with comprehensive error handling and audit logging
	 */
	async writeTextFile(
		filePath: string,
		content: string,
		encoding?: string
	): Promise<void> {
		logger.debug(LogCategory.FILE_OPS, 'Writing file', {
			filePath,
			contentLength: content.length,
			encoding,
			sessionId: this.sessionId,
		});

		try {
			// Validate and normalize path
			const normalizedPath = this.normalizePath(filePath);

			if (!this.validatePath(normalizedPath)) {
				const error = errorHandler.createInvalidPathError(
					filePath,
					'Invalid path format'
				);
				// logger.fileOp('write', filePath, false, new Error(error.message), this.sessionId, this.userId);
				throw new Error(error.message);
			}

			if (!this.isWithinVault(normalizedPath)) {
				const error = errorHandler.createVaultBoundaryViolationError(filePath);
				// logger.fileOp('write', filePath, false, new Error(error.message), this.sessionId, this.userId);
				throw new Error(error.message);
			}

			const absolutePath = this.resolveAbsolutePath(normalizedPath);

			// Check file extension
			const ext = path.extname(absolutePath).toLowerCase();
			if (this.allowedExtensions.size > 0 && !this.allowedExtensions.has(ext)) {
				const error = errorHandler.createPermissionDeniedError(
					'write',
					filePath
				);
				// logger.fileOp('write', filePath, false, new Error(error.message), this.sessionId, this.userId);
				throw new Error(error.message);
			}

			// Check content size
			const contentSize = Buffer.byteLength(
				content,
				(encoding as BufferEncoding) || 'utf8'
			);
			if (contentSize > this.maxFileSize) {
				const error = errorHandler.createJsonRpcError(
					ACPErrorCode.FILE_OPERATION_FAILED,
					`Content too large: ${contentSize} bytes, max ${this.maxFileSize}`,
					{ contentSize, maxSize: this.maxFileSize }
				);
				// logger.fileOp('write', filePath, false, new Error(error.message), this.sessionId, this.userId);
				throw new Error(error.message);
			}

			// Check if file exists before writing
			let fileExists = false;
			try {
				await fs.access(absolutePath);
				fileExists = true;
			} catch {
				// File doesn't exist
			}

			// Create parent directories if needed
			if (this.createDirectories) {
				const parentDir = path.dirname(absolutePath);
				await fs.mkdir(parentDir, { recursive: true });

				logger.debug(LogCategory.FILE_OPS, 'Created parent directories', {
					parentDir,
					sessionId: this.sessionId,
				});
			}

			// Write file content
			await fs.writeFile(
				absolutePath,
				content,
				(encoding as BufferEncoding) || 'utf8'
			);

			// Notify Obsidian of file changes
			if (this.obsidianNotifier) {
				if (fileExists) {
					this.obsidianNotifier.notifyFileModified(normalizedPath);
				} else {
					this.obsidianNotifier.notifyFileCreated(normalizedPath);
				}
			}

			// Log successful operation
			// logger.fileOp('write', filePath, true, undefined, this.sessionId, this.userId);

			logger.debug(LogCategory.FILE_OPS, 'File written successfully', {
				filePath,
				contentLength: content.length,
				fileExists,
				sessionId: this.sessionId,
			});
		} catch (error) {
			// Handle specific error types with enhanced error reporting
			const nodeError = error as NodeJS.ErrnoException;

			if (nodeError.code === 'ENOENT') {
				const enhancedError = errorHandler.createJsonRpcError(
					ACPErrorCode.FILE_OPERATION_FAILED,
					`Directory not found: ${path.dirname(filePath)}`,
					{ directory: path.dirname(filePath) }
				);
				// logger.fileOp('write', filePath, false, error as Error, this.sessionId, this.userId);
				throw new Error(enhancedError.message);
			}

			if (nodeError.code === 'EACCES') {
				const enhancedError = errorHandler.createPermissionDeniedError(
					'write',
					filePath
				);
				// logger.fileOp('write', filePath, false, error as Error, this.sessionId, this.userId);
				throw new Error(enhancedError.message);
			}

			// If it's already one of our custom errors, re-throw as is
			if (
				(error as Error).message.includes('Invalid path') ||
				(error as Error).message.includes('outside vault boundaries') ||
				(error as Error).message.includes('File type not allowed') ||
				(error as Error).message.includes('Content too large')
			) {
				throw error;
			}

			// Handle unexpected errors
			const errorInfo = errorHandler.handleError(
				error as Error,
				ErrorCategory.FILE_SYSTEM,
				{
					operation: 'write',
					filePath,
					contentLength: content.length,
					sessionId: this.sessionId,
				}
			);

			// logger.fileOp('write', filePath, false, error as Error, this.sessionId, this.userId);
			throw error;
		}
	}

	/**
	 * Validate file path format and security
	 */
	validatePath(filePath: string): boolean {
		if (!filePath || typeof filePath !== 'string') {
			return false;
		}

		// Check for null bytes
		if (filePath.includes('\0')) {
			return false;
		}

		// Check for dangerous path components (but allow .. for vault boundary checking)
		const dangerousPatterns = [
			/^\/+/, // Absolute paths starting with /
			/^[a-zA-Z]:[\\\/]/, // Windows absolute paths
			/[<>:"|?*]/, // Invalid filename characters
		];

		for (const pattern of dangerousPatterns) {
			if (pattern.test(filePath)) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Check if path is within vault boundaries
	 */
	isWithinVault(filePath: string): boolean {
		try {
			// Check for .. components that would escape the vault
			if (filePath.includes('..')) {
				return false;
			}

			const absolutePath = this.resolveAbsolutePath(filePath);
			const relativePath = path.relative(this.vaultPath, absolutePath);

			// Path is within vault if relative path doesn't start with '..' or '/'
			return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
		} catch {
			return false;
		}
	}

	/**
	 * Normalize path separators and resolve relative components
	 */
	private normalizePath(filePath: string): string {
		// Convert backslashes to forward slashes
		let normalized = filePath.replace(/\\/g, '/');

		// Remove leading slashes
		normalized = normalized.replace(/^\/+/, '');

		// Don't resolve .. components here - let isWithinVault handle them
		// Just clean up empty components and single dots
		const parts = normalized.split('/').filter((part) => part && part !== '.');

		return parts.join('/');
	}

	/**
	 * Resolve absolute path within vault
	 */
	private resolveAbsolutePath(filePath: string): string {
		return path.resolve(this.vaultPath, filePath);
	}

	/**
	 * Get vault path
	 */
	getVaultPath(): string {
		return this.vaultPath;
	}

	/**
	 * Get allowed extensions
	 */
	getAllowedExtensions(): string[] {
		return Array.from(this.allowedExtensions);
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: Partial<FileOperationsConfig>): void {
		logger.debug(LogCategory.FILE_OPS, 'Updating configuration', {
			config,
			sessionId: this.sessionId,
		});

		if (config.vaultPath) {
			this.vaultPath = path.resolve(config.vaultPath);
		}
		if (config.allowedExtensions) {
			this.allowedExtensions = new Set(config.allowedExtensions);
		}
		if (config.maxFileSize !== undefined) {
			this.maxFileSize = config.maxFileSize;
		}
		if (config.createDirectories !== undefined) {
			this.createDirectories = config.createDirectories;
		}
		if (config.obsidianNotifier !== undefined) {
			this.obsidianNotifier = config.obsidianNotifier;
		}
		if (config.sessionId !== undefined) {
			this.sessionId = config.sessionId;
		}
		if (config.userId !== undefined) {
			this.userId = config.userId;
		}

		logger.info(LogCategory.FILE_OPS, 'Configuration updated', {
			vaultPath: this.vaultPath,
			allowedExtensions: Array.from(this.allowedExtensions),
			maxFileSize: this.maxFileSize,
			sessionId: this.sessionId,
		});
	}

	/**
	 * Set Obsidian notifier
	 */
	setObsidianNotifier(notifier: ObsidianFileNotifier): void {
		this.obsidianNotifier = notifier;
		logger.debug(LogCategory.FILE_OPS, 'Obsidian notifier set', {
			sessionId: this.sessionId,
		});
	}

	/**
	 * Set session context for logging and audit
	 */
	setSessionContext(sessionId: string, userId?: string): void {
		this.sessionId = sessionId;
		this.userId = userId;

		logger.debug(LogCategory.FILE_OPS, 'Session context updated', {
			sessionId,
			userId,
		});
	}

	/**
	 * Get operation statistics
	 */
	getOperationStats(): {
		vaultPath: string;
		allowedExtensions: string[];
		maxFileSize: number;
		createDirectories: boolean;
		sessionId?: string;
		userId?: string;
	} {
		return {
			vaultPath: this.vaultPath,
			allowedExtensions: Array.from(this.allowedExtensions),
			maxFileSize: this.maxFileSize,
			createDirectories: this.createDirectories,
			sessionId: this.sessionId,
			userId: this.userId,
		};
	}
}
