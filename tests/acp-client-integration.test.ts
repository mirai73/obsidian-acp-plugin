/**
 * Integration tests for ACP Client Implementation
 */

import { ACPClientImpl } from '../src/core/acp-client-impl';
import { AgentConfig } from '../src/core/agent-process-manager';
import { ChildProcess } from 'child_process';

// Mock child_process
jest.mock('child_process');

describe('ACPClientImpl Integration', () => {
	let acpClient: ACPClientImpl;
	let mockProcess: Partial<ChildProcess>;

	beforeEach(() => {
		// Create mock process
		mockProcess = {
			pid: 12345,
			killed: false,
			stdout: {
				on: jest.fn(),
				setEncoding: jest.fn(),
			} as any,
			stderr: {
				on: jest.fn(),
			} as any,
			stdin: {
				write: jest.fn().mockImplementation((data) => {
					try {
						const request = JSON.parse(data);
						if (request.method === 'initialize') {
							// Simulate agent response
							const response = {
								jsonrpc: '2.0',
								id: request.id,
								result: {
									protocolVersion: 1,
									agentCapabilities: [
										'fs/read_text_file',
										'fs/write_text_file',
										'session/request_permission',
									],
								},
							};
							// Wait for next tick so the caller of write can finish
							setTimeout(() => {
								const stdoutHandlers = (
									mockProcess.stdout!.on as jest.Mock
								).mock.calls.filter((call) => call[0] === 'data');
								stdoutHandlers.forEach((call) => {
									call[1](Buffer.from(JSON.stringify(response) + '\n'));
								});
							}, 10);
						}
					} catch (e) {
						/* ignore non-json */
					}
					return true;
				}),
				end: jest.fn(),
				on: jest.fn(),
			} as any,
			on: jest.fn(),
			once: jest.fn().mockImplementation((event, callback) => {
				if (event === 'exit') {
					callback(0, null);
				}
				return mockProcess;
			}),
			kill: jest.fn().mockImplementation(() => {
				// Trigger exit when kill is called to avoid timeouts in shutdown
				const exitHandler = (mockProcess.once as jest.Mock).mock.calls.find(
					(call) => call[0] === 'exit'
				)?.[1];
				if (exitHandler) {
					setTimeout(() => exitHandler(0, 'SIGTERM'), 10);
				}
				return true;
			}),
		};

		// Mock spawn to return our mock process
		const { spawn } = require('child_process');
		spawn.mockReturnValue(mockProcess);

		acpClient = new ACPClientImpl();
	});

	afterEach(async () => {
		// Ensure we use real timers for cleanup
		jest.useRealTimers();
		await acpClient.shutdown();
		jest.clearAllMocks();
	}, 15000); // Increase timeout for cleanup

	describe('Agent lifecycle management', () => {
		it('should start and connect to an agent', async () => {
			jest.useFakeTimers();

			const startPromise = acpClient.startAgent('node', ['test-agent.js']);

			// Advance past spawn delay
			jest.advanceTimersByTime(1100);

			// Advance again for initialize response
			jest.advanceTimersByTime(100);

			await startPromise;

			const connectedAgents = acpClient.getConnectedAgents();
			expect(connectedAgents).toHaveLength(1);

			const agentId = connectedAgents[0];
			const status = acpClient.getConnectionStatus(agentId);
			expect(status.connected).toBe(true);

			jest.useRealTimers();
		});

		it('should handle agent disconnection', async () => {
			jest.useFakeTimers();

			const startPromise = acpClient.startAgent('node', ['test-agent.js']);
			jest.advanceTimersByTime(1100);
			jest.advanceTimersByTime(100);
			await startPromise;

			const connectedAgents = acpClient.getConnectedAgents();
			expect(connectedAgents).toHaveLength(1);

			// Simulate process exit
			const exitHandler = (mockProcess.on as jest.Mock).mock.calls.find(
				(call) => call[0] === 'exit'
			)?.[1];

			if (exitHandler) {
				exitHandler(0, null);
			}

			// Check that agent is no longer connected
			const updatedConnectedAgents = acpClient.getConnectedAgents();
			expect(updatedConnectedAgents).toHaveLength(0);

			jest.useRealTimers();
		});

		it('should handle multiple agents', async () => {
			jest.useFakeTimers();

			const config1: AgentConfig = {
				id: 'agent-1',
				name: 'Agent 1',
				command: 'node',
				args: ['agent1.js'],
				enabled: true,
			};

			const config2: AgentConfig = {
				id: 'agent-2',
				name: 'Agent 2',
				command: 'node',
				args: ['agent2.js'],
				enabled: true,
			};

			const start1Promise = acpClient.startAgentWithConfig(config1);
			const start2Promise = acpClient.startAgentWithConfig(config2);

			jest.advanceTimersByTime(1100);
			jest.advanceTimersByTime(100);

			await Promise.all([start1Promise, start2Promise]);

			const connectedAgents = acpClient.getConnectedAgents();
			expect(connectedAgents).toHaveLength(2);

			const statuses = acpClient.getAllConnectionStatuses();
			expect(statuses.get('agent-1')?.connected).toBe(true);
			expect(statuses.get('agent-2')?.connected).toBe(true);

			jest.useRealTimers();
		});
	});

	describe('Method handler registration', () => {
		it('should register and call file operation handlers', async () => {
			const readHandler = jest
				.fn()
				.mockResolvedValue({ content: 'test content' });
			const writeHandler = jest.fn().mockResolvedValue(undefined);

			acpClient.setFsReadTextFileHandler(readHandler);
			acpClient.setFsWriteTextFileHandler(writeHandler);

			// Test read handler
			const readResult = await acpClient.handleFsReadTextFile({
				sessionId: 'test-session',
				path: '/test.txt',
			});
			expect(readResult).toEqual({ content: 'test content' });
			expect(readHandler).toHaveBeenCalledWith({
				sessionId: 'test-session',
				path: '/test.txt',
			});

			// Test write handler
			await acpClient.handleFsWriteTextFile({
				sessionId: 'test-session',
				path: '/test.txt',
				content: 'new content',
			});
			expect(writeHandler).toHaveBeenCalledWith({
				sessionId: 'test-session',
				path: '/test.txt',
				content: 'new content',
			});
		});

		it('should register and call permission handler', async () => {
			const permissionHandler = jest.fn().mockResolvedValue({
				outcome: {
					outcome: 'selected',
					optionId: 'allow_once',
				},
			});

			acpClient.setSessionRequestPermissionHandler(permissionHandler);

			const result = await acpClient.handleSessionRequestPermission({
				sessionId: 'test-session',
				toolCall: {
					toolCallId: 'call_001',
					kind: 'read',
					path: '/test.txt',
				},
				options: [
					{ optionId: 'allow_once', name: 'Yes', kind: 'allow_once' },
					{ optionId: 'reject_once', name: 'No', kind: 'reject_once' },
				],
			});

			expect(result).toEqual({
				outcome: {
					outcome: 'selected',
					optionId: 'allow_once',
				},
			});
			expect(permissionHandler).toHaveBeenCalledWith({
				sessionId: 'test-session',
				toolCall: {
					toolCallId: 'call_001',
					kind: 'read',
					path: '/test.txt',
				},
				options: [
					{ optionId: 'allow_once', name: 'Yes', kind: 'allow_once' },
					{ optionId: 'reject_once', name: 'No', kind: 'reject_once' },
				],
			});
		});

		it('should handle session updates', () => {
			const updateHandler = jest.fn();

			acpClient.setSessionUpdateHandler(updateHandler);

			const updateParams = {
				sessionId: 'test-session',
				update: {
					sessionUpdate: 'message',
					data: { message: 'test' },
				},
			};

			acpClient.handleSessionUpdate(updateParams);

			expect(updateHandler).toHaveBeenCalledWith(updateParams);
		});
	});

	describe('Statistics and monitoring', () => {
		it('should provide client statistics', async () => {
			jest.useFakeTimers();

			const startPromise = acpClient.startAgent('node', ['test-agent.js']);
			jest.advanceTimersByTime(1100);
			jest.advanceTimersByTime(100);
			await startPromise;

			const stats = acpClient.getStats();

			expect(stats.connectedAgents).toBe(1);
			expect(stats.totalConnections).toBe(1);
			expect(stats.processStats.size).toBe(1);
			expect(stats.transportStats.size).toBe(1);

			jest.useRealTimers();
		});
	});

	describe('Error handling', () => {
		it('should throw error when no handlers are registered', async () => {
			// Create a client with file operations disabled to test fallback error
			const noHandlerClient = new ACPClientImpl({ fileOperations: null });

			await expect(
				noHandlerClient.handleFsReadTextFile({
					sessionId: 'test-session',
					path: '/test.txt',
				})
			).rejects.toThrow('File read handler not registered');

			await expect(
				noHandlerClient.handleFsWriteTextFile({
					sessionId: 'test-session',
					path: '/test.txt',
					content: 'test',
				})
			).rejects.toThrow('File write handler not registered');

			await expect(
				noHandlerClient.handleSessionRequestPermission({
					sessionId: 'test-session',
					toolCall: { toolCallId: 'call_001' },
					options: [
						{ optionId: 'allow_once', name: 'Yes', kind: 'allow_once' },
					],
				})
			).rejects.toThrow('Permission handler not registered');
		});

		it('should throw error when sending requests without agents', async () => {
			await expect(acpClient.sendRequest('test/method', {})).rejects.toThrow(
				'No agents connected'
			);

			expect(() => acpClient.sendNotification('test/notification', {})).toThrow(
				'No agents connected'
			);
		});
	});
});
