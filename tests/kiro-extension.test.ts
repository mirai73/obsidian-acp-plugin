import { kiroExtension } from '../src/extensions/kiro-extension';

const ctx = (request = jest.fn().mockResolvedValue({})) => ({
	emitSessionUpdate: jest.fn(),
	request,
});
const cmd = (name: string) =>
	kiroExtension.commands!.find((c) => c.name === name)!;

describe('kiroExtension commands', () => {
	beforeEach(() => {
		kiroExtension.notifications['_kiro/mcp/status'](
			{
				sessionId: 's1',
				servers: [
					{
						name: 'greeting',
						status: 'connected',
						tools: [{ name: 'greet', description: 'Greet someone' }],
					},
					{
						name: 'figma',
						status: 'failed',
						failedAuthorization: true,
					},
				],
			},
			ctx()
		);
		kiroExtension.notifications['_kiro/tools/didChange'](
			{
				sessionId: 's1',
				tags: [{ source: 'builtin', tag: 'read', description: 'read tools' }],
			},
			ctx()
		);
	});

	it('shows MCP servers with status tone, tool count and auth link', async () => {
		const panel = await cmd('mcp').run('', 's1', ctx());
		const items = panel.sections![0].items;
		expect(items[0]).toMatchObject({
			label: 'greeting',
			description: '1 tool(s)',
			badge: { text: 'connected', tone: 'success' },
		});
		expect(items[1]).toMatchObject({
			badge: { text: 'failed', tone: 'error' },
			action: { label: 'Sign in', command: '/mcp auth figma' },
		});
	});

	it('groups tools into built-in and per-server sections', async () => {
		const panel = await cmd('tools').run('', 's1', ctx());
		expect(panel.sections!.map((x) => x.heading)).toEqual([
			'Built-in',
			'MCP: greeting',
		]);
		expect(panel.sections![1].items[0].label).toBe('greet');
	});

	it('resets a server and closes the panel automatically', async () => {
		const request = jest.fn().mockResolvedValue({});
		const panel = await cmd('mcp').run('reset greeting', 's1', ctx(request));
		expect(request).toHaveBeenCalledWith('_kiro/mcp/resetServer', {
			sessionId: 's1',
			serverName: 'greeting',
		});
		expect(panel.message?.tone).toBe('success');
		expect(panel.autoCloseMs).toBeGreaterThan(0);
	});

	it('starts OAuth sign-in through resetServer', async () => {
		const request = jest.fn().mockReturnValue(new Promise(() => {}));
		const panel = await cmd('mcp').run('auth figma', 's1', ctx(request));
		expect(request).toHaveBeenCalledWith('_kiro/mcp/resetServer', {
			sessionId: 's1',
			serverName: 'figma',
			startOAuth: true,
		});
		expect(panel.message?.tone).toBe('success');
	});

	it('reports an immediate sign-in failure', async () => {
		const request = jest.fn().mockRejectedValue(new Error('not declared'));
		const panel = await cmd('mcp').run('auth figma', 's1', ctx(request));
		expect(panel.message).toMatchObject({ tone: 'error' });
	});

	it('advertises openExternalUrl and only opens http(s) URLs', async () => {
		expect(kiroExtension.clientCapabilities).toEqual({ openExternalUrl: true });
		const open = jest.fn();
		(global as any).window = { open };
		const handler = kiroExtension.requests!['_kiro/openExternalUrl'];
		await handler({ url: 'https://example.com/a' }, ctx());
		expect(open).toHaveBeenCalledWith('https://example.com/a', '_blank');
		await expect(
			handler({ url: 'file:///etc/passwd' }, ctx())
		).rejects.toThrow();
	});

	it('keeps error panels open', async () => {
		const request = jest.fn().mockRejectedValue(new Error('boom'));
		const panel = await cmd('compact').run('', 's1', ctx(request));
		expect(request).toHaveBeenCalledWith('_kiro/session/compact', {
			sessionId: 's1',
		});
		expect(panel.message).toMatchObject({ tone: 'error' });
		expect(panel.message?.text).toContain('boom');
		expect(panel.autoCloseMs).toBeUndefined();
	});

	it('reports missing data for unknown sessions', async () => {
		const panel = await cmd('tools').run('', 'nope', ctx());
		expect(panel.message?.text).toContain('No tool');
	});
});
