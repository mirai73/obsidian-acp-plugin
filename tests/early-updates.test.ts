import { SessionManagerImpl } from '../src/core/session-manager';

describe('updates arriving before the session/new response', () => {
	it('keeps commands advertised before the response', async () => {
		const chunks: any[] = [];
		const manager = new SessionManagerImpl({
			onStreamingChunk: (id, chunk) => chunks.push({ id, chunk }),
		});
		const client: any = {
			sendRequest: jest.fn(async (method: string) => {
				if (method !== 'session/new') return {};
				manager.handleStreamingUpdate({
					sessionId: 's1',
					update: {
						sessionUpdate: 'available_commands_update',
						availableCommands: [{ name: 'context-gatherer', description: 'd' }],
					},
				});
				return { sessionId: 's1' };
			}),
		};

		await manager.createSession('kiro', client);

		expect(manager.getSessionInfo('s1')?.availableCommands).toEqual([
			{ name: 'context-gatherer', description: 'd' },
		]);
		manager.shutdown();
	});
});
