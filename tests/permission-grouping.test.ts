import { ACPClientImpl } from '../src/core/acp-client-impl';

const config: any = { id: 'Kiro', name: 'Kiro', command: 'kiro-cli', args: [] };
const request = (round: number, resource = 'ls docs; ls') => ({
	sessionId: 's1',
	toolCall: { toolCallId: 'tc1', title: resource },
	options: [
		{ optionId: 'accept', name: 'Allow', kind: 'allow_once' },
		{ optionId: 'always-accept', name: 'Always allow', kind: 'allow_always' },
		{ optionId: 'reject', name: 'Deny', kind: 'reject_once' },
	],
	_meta: {
		kiro: {
			consentRound: round,
			consent: { capability: 'shell', resource },
		},
	},
});

function makeClient(answer: any) {
	const client: any = Object.create(ACPClientImpl.prototype);
	client.permissionDecisions = new Map();
	client.handleSessionRequestPermission = jest.fn().mockResolvedValue(answer);
	return client as {
		requestPermissionOncePerGroup(c: any, p: any): Promise<any>;
		handleSessionRequestPermission: jest.Mock;
	};
}

describe('permission grouping', () => {
	const selected = {
		outcome: { outcome: 'selected', optionId: 'always-accept' },
	};

	it('asks once for the consent rounds of one command, even when concurrent', async () => {
		const client = makeClient(selected);
		const [a, b] = await Promise.all([
			client.requestPermissionOncePerGroup(config, request(1)),
			client.requestPermissionOncePerGroup(config, request(2)),
		]);
		expect(a).toEqual(selected);
		expect(b).toEqual(selected);
		expect(client.handleSessionRequestPermission).toHaveBeenCalledTimes(1);
	});

	it('asks again for a different command', async () => {
		const client = makeClient(selected);
		await client.requestPermissionOncePerGroup(config, request(1));
		await client.requestPermissionOncePerGroup(config, request(1, 'rm -rf x'));
		expect(client.handleSessionRequestPermission).toHaveBeenCalledTimes(2);
	});

	it('shares a denial too', async () => {
		const client = makeClient({ outcome: { outcome: 'cancelled' } });
		await client.requestPermissionOncePerGroup(config, request(1));
		const second = await client.requestPermissionOncePerGroup(
			config,
			request(2)
		);
		expect(second).toEqual({ outcome: { outcome: 'cancelled' } });
		expect(client.handleSessionRequestPermission).toHaveBeenCalledTimes(1);
	});

	it('does not group requests from agents without the extension', async () => {
		const client = makeClient(selected);
		const other = { id: 'x', name: 'Other', command: 'other', args: [] };
		await client.requestPermissionOncePerGroup(other, request(1));
		await client.requestPermissionOncePerGroup(other, request(2));
		expect(client.handleSessionRequestPermission).toHaveBeenCalledTimes(2);
	});
});
