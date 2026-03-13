/**
 * File Operations Handler Interface
 * Defines the contract for file system operations within vault boundaries
 */

export interface FileOperationsHandler {
	readTextFile(path: string): Promise<{ content: string; encoding?: string }>;
	writeTextFile(
		path: string,
		content: string,
		encoding?: string
	): Promise<void>;
	validatePath(path: string): boolean;
	isWithinVault(path: string): boolean;
}
