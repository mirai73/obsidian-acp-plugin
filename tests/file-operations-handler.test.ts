/**
 * File Operations Handler Tests
 * Basic unit tests for the file operations handler implementation
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileOperationsHandlerImpl } from '../src/core/file-operations-handler';
import {
	ACPFileSystemHandlers,
	JsonRpcError,
} from '../src/core/acp-method-handlers';

describe('FileOperationsHandler', () => {
	let tempDir: string;
	let handler: FileOperationsHandlerImpl;
	let acpHandlers: ACPFileSystemHandlers;

	beforeEach(async () => {
		// Create temporary directory for testing
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'acp-test-'));

		handler = new FileOperationsHandlerImpl({
			vaultPath: tempDir,
			allowedExtensions: ['.md', '.txt', '.json'],
			maxFileSize: 1024 * 1024, // 1MB for testing
			createDirectories: true,
		});

		acpHandlers = new ACPFileSystemHandlers(handler);
	});

	afterEach(async () => {
		// Clean up temporary directory
		await fs.rmdir(tempDir, { recursive: true }).catch(() => {});
	});

	describe('readTextFile', () => {
		it('should read existing file content', async () => {
			const testContent = 'Hello, World!';
			const testFile = 'test.md';
			const filePath = path.join(tempDir, testFile);

			await fs.writeFile(filePath, testContent, 'utf8');

			const result = await handler.readTextFile(testFile);

			expect(result.content).toBe(testContent);
			expect(result.encoding).toBe('utf8');
		});

		it('should throw error for non-existent file', async () => {
			await expect(handler.readTextFile('nonexistent.md')).rejects.toThrow(
				'could not be found'
			);
		});

		it('should enforce vault boundaries', async () => {
			await expect(handler.readTextFile('../outside.md')).rejects.toThrow(
				'outside your vault'
			);
		});

		it('should validate file extensions', async () => {
			const testFile = 'test.exe';
			const filePath = path.join(tempDir, testFile);

			await fs.writeFile(filePath, 'content', 'utf8');

			await expect(handler.readTextFile(testFile)).rejects.toThrow(
				'Access denied'
			);
		});
	});

	describe('writeTextFile', () => {
		it('should write file content', async () => {
			const testContent = 'Hello, World!';
			const testFile = 'test.md';

			await handler.writeTextFile(testFile, testContent);

			const filePath = path.join(tempDir, testFile);
			const writtenContent = await fs.readFile(filePath, 'utf8');

			expect(writtenContent).toBe(testContent);
		});

		it('should create directories', async () => {
			const testContent = 'Hello, World!';
			const testFile = 'subdir/test.md';

			await handler.writeTextFile(testFile, testContent);

			const filePath = path.join(tempDir, testFile);
			const writtenContent = await fs.readFile(filePath, 'utf8');

			expect(writtenContent).toBe(testContent);
		});

		it('should enforce vault boundaries', async () => {
			await expect(
				handler.writeTextFile('../outside.md', 'content')
			).rejects.toThrow('outside your vault');
		});

		it('should validate file extensions', async () => {
			await expect(
				handler.writeTextFile('test.exe', 'content')
			).rejects.toThrow('Access denied');
		});
	});

	describe('ACP method handlers', () => {
		it('should handle fs/read_text_file with valid params', async () => {
			const testContent = 'Hello, World!';
			const testFile = 'test.md';
			const filePath = path.join(tempDir, testFile);

			await fs.writeFile(filePath, testContent, 'utf8');

			const result = await acpHandlers.handleFsReadTextFile({
				sessionId: 'test-session',
				path: testFile,
			});

			expect(result.content).toBe(testContent);
			expect(result.encoding).toBe('utf8');
		});

		it('should handle fs/write_text_file with valid params', async () => {
			const testContent = 'Hello, World!';
			const testFile = 'test.md';

			await acpHandlers.handleFsWriteTextFile({
				sessionId: 'test-session',
				path: testFile,
				content: testContent,
			});

			const filePath = path.join(tempDir, testFile);
			const writtenContent = await fs.readFile(filePath, 'utf8');

			expect(writtenContent).toBe(testContent);
		});

		it('should return proper JSON-RPC errors for invalid params', async () => {
			await expect(acpHandlers.handleFsReadTextFile({} as any)).rejects.toThrow(
				JsonRpcError
			);

			await expect(
				acpHandlers.handleFsWriteTextFile({} as any)
			).rejects.toThrow(JsonRpcError);
		});

		it('should map file errors to JSON-RPC errors', async () => {
			try {
				await acpHandlers.handleFsReadTextFile({
					sessionId: 'test-session',
					path: 'nonexistent.md',
				});
				fail('Should have thrown an error');
			} catch (error) {
				expect(error).toBeInstanceOf(JsonRpcError);
				expect((error as JsonRpcError).code).toBe(-32001); // FILE_NOT_FOUND
			}
		});
	});

	describe('path validation', () => {
		it('should validate safe paths', () => {
			expect(handler.validatePath('test.md')).toBe(true);
			expect(handler.validatePath('folder/test.md')).toBe(true);
			expect(handler.validatePath('deep/nested/folder/test.md')).toBe(true);
			expect(handler.validatePath('../test.md')).toBe(true); // Allowed in validatePath, checked in isWithinVault
		});

		it('should reject dangerous paths', () => {
			expect(handler.validatePath('/absolute/path.md')).toBe(false);
			expect(handler.validatePath('C:\\windows\\path.md')).toBe(false);
			expect(handler.validatePath('test\0.md')).toBe(false);
			expect(handler.validatePath('test<>.md')).toBe(false);
		});

		it('should check vault boundaries', () => {
			expect(handler.isWithinVault('test.md')).toBe(true);
			expect(handler.isWithinVault('folder/test.md')).toBe(true);
			expect(handler.isWithinVault('../outside.md')).toBe(false);
		});
	});
});
